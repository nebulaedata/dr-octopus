/**
 * @author Codex
 * @description Lists authorized paths and searches pinned native snapshots with bounded private fd/rg Jobs.
 */
import { randomUUID } from 'node:crypto';
import { readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join, relative, posix } from 'node:path';
import { z } from 'zod';
import { BasicToolError } from './basic-inputs';
import type { NativeFileCommit } from './native-file-commit';
import type { FindInput, GrepInput, LsInput } from './search-inputs';
import {
  isExecutorStoragePath,
  isWithinRoot,
  resolveReadableFile,
  resolveSearchDirectory,
} from './file-policy';
import { decodeText } from './text-file';
import { SearchProcess } from './search-process';

type Scope = { cwd: string; signal: AbortSignal };
type Entry = {
  path: string;
  type: 'file' | 'directory' | 'reparse';
  size?: number;
  line?: number;
  text?: string;
  kind?: 'match' | 'context';
  textTruncated?: boolean;
};
export type SearchResult = {
  entries: Entry[];
  status: 'complete' | 'matches' | 'no_match' | 'partial';
  truncated: boolean;
  skippedFiles: number;
  executionState: 'quiescent';
  limits: {
    results: number;
    outputBytes: number;
    timeoutMs: number;
    candidates: number;
    snapshotBytes: number;
  };
};
const eventSchema = z.object({
  type: z.enum(['begin', 'end', 'summary', 'match', 'context']),
  data: z
    .object({
      path: z.object({ text: z.string() }).optional(),
      lines: z.object({ text: z.string() }).optional(),
      line_number: z.number().int().positive().optional(),
    })
    .passthrough(),
});

/**
 * Starts a finite result; serialized output reserves room for truncation and skipped-file metadata.
 */
function result(limit: number): SearchResult {
  return {
    entries: [],
    status: 'complete',
    truncated: false,
    skippedFiles: 0,
    executionState: 'quiescent',
    limits: {
      results: limit,
      outputBytes: 50 * 1024,
      timeoutMs: 30000,
      candidates: 10000,
      snapshotBytes: 64 * 1024 * 1024,
    },
  };
}

/**
 * Measures JSON escaping and metadata rather than assuming raw text length equals transport size.
 */
function append(output: SearchResult, entry: Entry): boolean {
  if (output.entries.length >= output.limits.results) {
    output.truncated = true;
    return false;
  }
  output.entries.push(entry);
  if (Buffer.byteLength(JSON.stringify(output)) > output.limits.outputBytes - 512) {
    output.entries.pop();
    output.truncated = true;
    return false;
  }
  return true;
}

/**
 * Checks cancellation and the total operation deadline between finite filesystem/process calls.
 */
function check(scope: Scope, deadline: number): void {
  if (scope.signal.aborted) {
    throw new BasicToolError('SEARCH_CANCELLED', 'The readonly operation was cancelled.');
  }
  if (Date.now() >= deadline) {
    throw new BasicToolError('SEARCH_TIMEOUT', 'The readonly operation exceeded its finite budget.');
  }
}

export class SearchTools {
  private active = 0;
  private blocked = false;
  private readonly process: SearchProcess;

  /**
   * Keeps process selection and private snapshot storage inside the trusted Runtime.
   */
  constructor(
    supervisor: string,
    resources: string,
    private readonly data: string,
    private readonly native: NativeFileCommit
  ) {
    this.process = new SearchProcess(supervisor, resources);
  }

  /**
   * Validates both pinned backends before declaring Runtime initialization complete.
   */
  async verify(): Promise<void> {
    await this.process.verify();
    if ((await readdir(this.data)).some((name) => name.startsWith('.octopus-executor-recovery-search-'))) {
      throw new BasicToolError(
        'SEARCH_RECOVERY_REQUIRED',
        'Prior search snapshots require inspection before Runtime startup.'
      );
    }
  }

  /**
   * Lists one pinned directory without following any reparse entry or creating file observations.
   */
  async ls(input: LsInput, scope: Scope): Promise<SearchResult> {
    return this.admit(scope, async (deadline) => {
      const directory = await resolveSearchDirectory(input.path, scope.cwd);
      const listing = await this.native.list(directory);
      if (!listing.ok) {
        throw new BasicToolError('SEARCH_PATH_REJECTED', 'The directory cannot be safely listed.');
      }
      check(scope, deadline);
      const output = result(input.limit);
      output.truncated = listing.entries.length >= 10001;
      for (const entry of listing.entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (
          entry.name.toLowerCase().startsWith('.octopus-executor-recovery-') ||
          entry.name.toLowerCase().startsWith('octopus-executor-') ||
          isExecutorStoragePath(join(directory, entry.name)) ||
          (!input.hidden && (entry.name.startsWith('.') || entry.attributes & 2))
        ) {
          continue;
        }
        if (
          !append(output, {
            path: entry.name,
            type: entry.attributes & 1024 ? 'reparse' : entry.attributes & 16 ? 'directory' : 'file',
            ...(!(entry.attributes & (1024 | 16)) ? { size: entry.size } : {}),
          })
        ) {
          break;
        }
      }
      output.status = output.truncated ? 'partial' : 'complete';
      return output;
    });
  }

  /**
   * Returns validated file paths from fd; inventory output is never accepted as an authorization grant.
   */
  async find(input: FindInput, scope: Scope): Promise<SearchResult> {
    return this.admit(scope, async (deadline) => {
      const directory = await resolveSearchDirectory(input.path, scope.cwd);
      const inventory = await this.inventory(input, scope, directory, deadline);
      const output = result(input.limit);
      output.truncated = inventory.truncated;
      for (const candidate of inventory.paths) {
        check(scope, deadline);
        const path = await resolveReadableFile(candidate.replaceAll('/', '\\'), directory);
        if (!isWithinRoot(directory, path)) {
          throw new BasicToolError(
            'SEARCH_PATH_REJECTED',
            'A candidate is outside the requested search directory.'
          );
        }
        const inspected = await this.native.inspect(path);
        if (!inspected.ok || inspected.directory) {
          throw new BasicToolError('SEARCH_PATH_REJECTED', 'A candidate path changed or is unsupported.');
        }
        if (!append(output, { path: relative(directory, path), type: 'file' })) {
          break;
        }
      }
      output.status = output.truncated ? 'partial' : 'complete';
      return output;
    });
  }

  /**
   * Searches only private copies produced by pinned native reads; rg never opens user-selected source paths.
   * The copies are per-file snapshots and do not promise one atomic snapshot of the whole query directory.
   */
  async grep(input: GrepInput, scope: Scope): Promise<SearchResult> {
    return this.admit(scope, async (deadline) => {
      const directory = await resolveSearchDirectory(input.path, scope.cwd);
      const snapshotDirectory = join(this.data, `.octopus-executor-recovery-search-${randomUUID()}`);
      const created = await this.native.createRecovery(snapshotDirectory);
      if (!created.ok || !created.privateAcl) {
        throw new BasicToolError('SEARCH_STORAGE_FAILED', 'Private snapshot storage could not be created.');
      }
      const names = new Map<string, string>();
      const output = result(input.limit);
      let supervisionLost = false;
      try {
        const args = [
          '--json',
          '--no-config',
          '--color',
          'never',
          '--no-ignore',
          '--hidden',
          '--encoding',
          'utf-8',
          '--max-count',
          String(input.limit + 1),
          '--context',
          String(input.context),
          ...(input.literal ? ['--fixed-strings'] : []),
          ...(input.ignoreCase ? ['--ignore-case'] : []),
          '--regexp',
          input.pattern,
          '.',
        ];
        // Validate regex even if fd finds no eligible files.
        const validation = await this.process.run(
          'rg',
          args,
          snapshotDirectory,
          scope.signal,
          deadline - Date.now()
        );
        if (validation.terminal.exitCode === 2) {
          throw new BasicToolError('INVALID_PATTERN', 'The Rust regular expression is invalid.');
        }
        const inventory = await this.inventory(
          { ...input, pattern: input.glob ?? '*' },
          scope,
          directory,
          deadline
        );
        output.truncated = inventory.truncated;
        let bytes = 0;
        for (const candidate of inventory.paths) {
          check(scope, deadline);
          const path = await resolveReadableFile(candidate.replaceAll('/', '\\'), directory);
          if (!isWithinRoot(directory, path)) {
            throw new BasicToolError(
              'SEARCH_PATH_REJECTED',
              'A candidate is outside the requested search directory.'
            );
          }
          const snapshot = await this.native.readSnapshot(path);
          if (!snapshot.ok) {
            if (snapshot.nativeCode === 5) {
              throw new BasicToolError(
                'SEARCH_PERMISSION_DENIED',
                'A candidate file could not be read with current filesystem permissions.'
              );
            }
            if (snapshot.nativeCode === 223) {
              output.skippedFiles++;
              continue;
            }
            throw new BasicToolError('SEARCH_PATH_REJECTED', 'A candidate could not be safely snapshotted.');
          }
          try {
            decodeText(snapshot.bytes);
          } catch (error) {
            if (
              error instanceof BasicToolError &&
              ['UNSUPPORTED_FILE', 'INVALID_UTF8'].includes(error.code)
            ) {
              output.skippedFiles++;
              continue;
            }
            throw error;
          }
          if (bytes + snapshot.bytes.length > output.limits.snapshotBytes) {
            output.truncated = true;
            break;
          }
          bytes += snapshot.bytes.length;
          const name = `${names.size}.txt`;
          names.set(name, relative(directory, path));
          await writeFile(join(snapshotDirectory, name), snapshot.bytes, { flag: 'wx' });
        }
        check(scope, deadline);
        const searched = await this.process.run(
          'rg',
          args,
          snapshotDirectory,
          scope.signal,
          deadline - Date.now()
        );
        if (searched.terminal.exitCode > 1 && searched.terminal.reason !== 'output_limit') {
          throw new BasicToolError('SEARCH_PROCESS_FAILED', 'The private content search failed.');
        }
        output.truncated ||= searched.terminal.reason === 'output_limit';
        const lines = new TextDecoder('utf-8', { fatal: true })
          .decode(searched.stdout, { stream: output.truncated })
          .split('\n');
        if (lines.at(-1) !== '') {
          if (!output.truncated) {
            throw new BasicToolError(
              'SEARCH_RESULT_INVALID',
              'Search output ended with an incomplete record.'
            );
          }
          lines.pop();
        }
        for (const line of lines.filter(Boolean)) {
          const event = eventSchema.parse(JSON.parse(line));
          if (event.type !== 'match' && event.type !== 'context') {
            continue;
          }
          const name = event.data.path?.text;
          const path = name && names.get(basename(name));
          if (!path || !event.data.lines || !event.data.line_number || !/^\.?[\\/]?\d+\.txt$/.test(name!)) {
            throw new BasicToolError(
              'SEARCH_RESULT_INVALID',
              'Search output referenced an unknown snapshot.'
            );
          }
          const text = event.data.lines.text.replace(/\r?\n$/, '');
          const clipped = [...text].slice(0, 2000).join('');
          output.truncated ||= clipped.length !== text.length;
          if (
            !append(output, {
              path,
              type: 'file',
              line: event.data.line_number,
              text: clipped,
              kind: event.type,
              textTruncated: clipped.length !== text.length,
            })
          ) {
            break;
          }
        }
        output.status =
          output.truncated || output.skippedFiles
            ? 'partial'
            : output.entries.length
              ? 'matches'
              : 'no_match';
        return output;
      } catch (error) {
        supervisionLost = error instanceof BasicToolError && error.code === 'SEARCH_SUPERVISION_LOST';
        this.blocked ||= supervisionLost;
        throw error;
      } finally {
        if (!supervisionLost) {
          await this.cleanupSnapshots(snapshotDirectory, created.identity, [...names.keys()]);
        }
      }
    });
  }

  /**
   * Removes only known snapshots after all owned processes drained; unknown or changed children are retained.
   */
  private async cleanupSnapshots(
    directory: string,
    identity: string,
    names: readonly string[]
  ): Promise<void> {
    try {
      await this.removeSnapshots(directory, identity, names);
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }

  /**
   * Checks directory identity and deletes known direct children without recursive traversal.
   */
  private async removeSnapshots(
    directory: string,
    identity: string,
    names: readonly string[]
  ): Promise<void> {
    const current = await this.native.inspect(directory);
    if (!current.ok || current.identity !== identity || !current.privateAcl) {
      throw new BasicToolError('SEARCH_STORAGE_CHANGED', 'Private search material changed and was retained.');
    }
    for (const name of names) {
      try {
        await unlink(join(directory, name));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error;
        }
      }
    }
    await rmdir(directory);
  }

  /**
   * Enumerates at most 10001 ordinary file candidates, excluding internal material even when ignores are disabled.
   */
  private async inventory(input: FindInput, scope: Scope, directory: string, deadline: number) {
    check(scope, deadline);
    const pattern = input.pattern.replaceAll('\\', '/');
    const pathPattern = pattern.includes('/');
    const searched = await this.process.run(
      'fd',
      [
        '--glob',
        '--case-sensitive',
        '--print0',
        '--color',
        'never',
        '--type',
        'f',
        '--no-follow',
        '--no-ignore-parent',
        '--no-require-git',
        '--threads',
        '1',
        '--max-results',
        '10001',
        '--exclude',
        '.octopus-executor-recovery-*',
        '--exclude',
        'octopus-executor-*',
        ...(input.hidden ? ['--hidden'] : []),
        ...(!input.ignore ? ['--no-ignore'] : []),
        '--',
        pathPattern ? '*' : pattern,
        '.',
      ],
      directory,
      scope.signal,
      deadline - Date.now()
    );
    if (searched.terminal.exitCode !== 0 && searched.terminal.reason !== 'output_limit') {
      throw new BasicToolError('INVALID_GLOB', 'File discovery failed or the glob is invalid.');
    }
    if (searched.stderr.length && searched.terminal.reason !== 'output_limit') {
      throw new BasicToolError(
        'SEARCH_ENUMERATION_FAILED',
        'File discovery could not traverse every requested path.'
      );
    }
    // Native paths cannot contain NUL. Drop only a cut final record when the output cap fired.
    const end = searched.stdout.lastIndexOf(0);
    const paths =
      end < 0
        ? []
        : new TextDecoder('utf-8', { fatal: true }).decode(searched.stdout.subarray(0, end)).split('\0');
    return {
      // fd's glob-to-regex conversion does not normalize native Windows separators for full-path globs.
      // Keep bounded fd discovery, then match directory globs against normalized relative paths in Node.
      paths: paths
        .slice(0, 10000)
        .filter((path) => !isExecutorStoragePath(join(directory, path)))
        .filter(
          (path) =>
            !pathPattern || posix.matchesGlob(path.replaceAll('\\', '/').replace(/^\.\//, ''), pattern)
        ),
      truncated: paths.length > 10000 || searched.terminal.reason === 'output_limit',
    };
  }

  /**
   * Bounds aggregate snapshot/process memory across tasks and translates infrastructure errors at this boundary.
   */
  private async admit(scope: Scope, run: (deadline: number) => Promise<SearchResult>): Promise<SearchResult> {
    if (this.blocked) {
      throw new BasicToolError(
        'SEARCH_RECOVERY_REQUIRED',
        'Search storage or supervision requires inspection.'
      );
    }
    if (this.active >= 4) {
      throw new BasicToolError('RUNTIME_BUSY', 'The concurrent readonly search limit was reached.');
    }
    this.active++;
    try {
      const deadline = Date.now() + 30000;
      check(scope, deadline);
      return await run(deadline);
    } catch (error) {
      if (error instanceof BasicToolError) {
        throw error;
      }
      throw new BasicToolError(
        'SEARCH_FAILED',
        'Readonly search failed without returning unvalidated results.'
      );
    } finally {
      this.active--;
    }
  }
}
