/**
 * @author Codex
 * @description Owns Workspace lifecycle and safe filesystem operations behind one application Interface.
 */
import { mkdir, readFile, rm, stat, writeFile } from './workspaces.repository.js';
import { basename, dirname, posix } from 'node:path';
import { ZipArchive } from 'archiver';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import { hasErrorCode, normalizeRelativePath, resolveWithinRoot } from './workspaces.utils.js';
import { readDirectorySafely, resolveWorkspaceReferenceSelection } from './workspaces.repository.js';
import type { Readable } from 'node:stream';
import type { FileTreeEntryDto, WorkspaceReferenceDto } from '@octopus/shared/protocol';
import type { WorkspaceDescriptor, WorkspaceSelector, WorkspaceService } from '@octopus/agent';

const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;

export type WorkspaceFileEntryKind = 'file' | 'directory';

export type WorkspaceFileDownload =
  | { kind: 'file'; absolutePath: string; filename: string }
  | { kind: 'zip'; stream: Readable; filename: string };

export interface WorkspacesServiceOptions {
  workspaceBackend: WorkspaceService;
}

/**
 * Presents Workspace lifecycle and filesystem behavior through one cohesive application Module.
 */
export class WorkspacesService {
  readonly #workspaceBackend: WorkspaceService;

  /**
   * @param options Supplies the authoritative Workspace backend.
   */
  public constructor(options: WorkspacesServiceOptions) {
    this.#workspaceBackend = options.workspaceBackend;
  }

  /**
   * Lists trusted Server-side Workspaces.
   */
  public list(): Promise<WorkspaceDescriptor[]> {
    return this.#workspaceBackend.list();
  }

  /**
   * Resolves a trusted Workspace by id or slug.
   *
   * @param selector Unique Workspace selector.
   */
  public resolve(selector: WorkspaceSelector): Promise<WorkspaceDescriptor> {
    return this.#workspaceBackend.resolve(selector);
  }

  /**
   * Resolves user-selected Workspace references without exposing absolute Host paths.
   *
   * @param workspaceId Workspace that owns every relative path.
   * @param references Untrusted references received from the Browser.
   * @returns Normalized references whose existing filesystem kinds match the requested kinds.
   * @throws When a reference is stale, crosses the Workspace boundary, or has the wrong kind.
   */
  public async resolveReferences(
    workspaceId: string,
    references: readonly WorkspaceReferenceDto[]
  ): Promise<WorkspaceReferenceDto[]> {
    const workspace = await this.resolve({ id: workspaceId });
    return resolveWorkspaceReferenceSelection(workspace.cwd, references);
  }

  /**
   * Creates a trusted Workspace without accepting a browser filesystem path.
   *
   * @param command User-controlled Workspace name and optional slug.
   */
  public create(command: { name: string; slug?: string }): Promise<WorkspaceDescriptor> {
    return this.#workspaceBackend.create(command);
  }

  /**
   * Lists direct children under a Workspace-relative path.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath Path relative to the Workspace root.
   */
  public async listEntries(workspaceId: string, relativePath: string): Promise<FileTreeEntryDto[]> {
    const workspace = await this.resolve({ id: workspaceId });
    const safeRelative = normalizeRelativePath(relativePath);
    const absoluteDir = resolveWithinRoot(workspace.cwd, safeRelative);
    return this.#readDirectory(absoluteDir, safeRelative);
  }

  /**
   * Creates an empty file or directory inside a Workspace.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath Path relative to the Workspace root.
   * @param type Entry kind to create.
   */
  public async createEntry(
    workspaceId: string,
    relativePath: string,
    type: WorkspaceFileEntryKind
  ): Promise<FileTreeEntryDto> {
    const workspace = await this.resolve({ id: workspaceId });
    const safeRelative = normalizeRelativePath(relativePath);
    if (safeRelative.length === 0) {
      throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
        statusCode: 400,
      });
    }
    const absolutePath = resolveWithinRoot(workspace.cwd, safeRelative);
    try {
      if (type === 'directory') {
        await mkdir(absolutePath, { recursive: false });
      } else {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, '', { flag: 'wx' });
      }
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        throw new ApplicationError(
          'WORKSPACE_FILE_ALREADY_EXISTS',
          'An entry with this name already exists.',
          { statusCode: 409, cause: error }
        );
      }
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ApplicationError('WORKSPACE_FILE_NOT_FOUND', 'Target directory was not found.', {
          statusCode: 404,
          cause: error,
        });
      }
      throw new ApplicationError('WORKSPACE_FILE_CREATE_FAILED', 'Unable to create Workspace entry.', {
        statusCode: 500,
        cause: error,
      });
    }
    return {
      name: basename(safeRelative),
      path: safeRelative,
      type,
    };
  }

  /**
   * Deletes files or directories recursively inside a Workspace.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePaths Paths relative to the Workspace root.
   */
  public async deleteEntries(workspaceId: string, relativePaths: string[]): Promise<void> {
    const workspace = await this.resolve({ id: workspaceId });
    for (const relativePath of relativePaths) {
      const safeRelative = normalizeRelativePath(relativePath);
      if (safeRelative.length === 0) {
        throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
          statusCode: 400,
        });
      }
      const absolutePath = resolveWithinRoot(workspace.cwd, safeRelative);
      try {
        await rm(absolutePath, { recursive: true, force: false });
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) {
          throw new ApplicationError('WORKSPACE_FILE_NOT_FOUND', 'Workspace entry was not found.', {
            statusCode: 404,
            cause: error,
          });
        }
        throw new ApplicationError('WORKSPACE_FILE_DELETE_FAILED', 'Unable to delete Workspace entry.', {
          statusCode: 500,
          cause: error,
        });
      }
    }
  }

  /**
   * Writes an uploaded Base64-encoded file inside a Workspace.
   *
   * @param workspaceId Target Workspace id.
   * @param relativeDir Destination directory relative to the Workspace root.
   * @param name Filename without path separators.
   * @param base64Data Base64-encoded file contents.
   */
  public async writeUploadedFile(
    workspaceId: string,
    relativeDir: string,
    name: string,
    base64Data: string
  ): Promise<FileTreeEntryDto> {
    const workspace = await this.resolve({ id: workspaceId });
    const safeDir = normalizeRelativePath(relativeDir);
    if (name.length === 0 || /[\\/]/.test(name) || name === '.' || name === '..') {
      throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested file name is invalid.', {
        statusCode: 400,
      });
    }
    const safeRelative = safeDir ? posix.join(safeDir, name) : name;
    const absolutePath = resolveWithinRoot(workspace.cwd, safeRelative);
    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, Buffer.from(base64Data, 'base64'));
    } catch (error) {
      throw new ApplicationError('WORKSPACE_FILE_UPLOAD_FAILED', 'Unable to store uploaded file.', {
        statusCode: 500,
        cause: error,
      });
    }
    return { name, path: safeRelative, type: 'file' };
  }

  /**
   * Reads a bounded UTF-8 text file for browser editing.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath File path relative to the Workspace root.
   */
  public async readFileContent(workspaceId: string, relativePath: string): Promise<string> {
    const absolutePath = await this.#resolveEditableFile(workspaceId, relativePath);
    try {
      const content = await readFile(absolutePath);
      if (content.includes(0)) {
        throw new ApplicationError('WORKSPACE_FILE_BINARY_UNSUPPORTED', 'Binary files cannot be edited.', {
          statusCode: 415,
        });
      }
      return content.toString('utf8');
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError('WORKSPACE_FILE_READ_FAILED', 'Unable to read Workspace file.', {
        statusCode: 500,
        cause: error,
      });
    }
  }

  /**
   * Replaces the contents of a bounded UTF-8 text file.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath File path relative to the Workspace root.
   * @param content Complete UTF-8 text to persist.
   */
  public async updateFileContent(workspaceId: string, relativePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES) {
      throw new ApplicationError('WORKSPACE_FILE_TOO_LARGE', 'File is too large to edit.', {
        statusCode: 413,
      });
    }
    const absolutePath = await this.#resolveEditableFile(workspaceId, relativePath);
    try {
      await writeFile(absolutePath, content, 'utf8');
    } catch (error) {
      throw new ApplicationError('WORKSPACE_FILE_WRITE_FAILED', 'Unable to save Workspace file.', {
        statusCode: 500,
        cause: error,
      });
    }
  }

  /**
   * Prepares a file stream or directory archive for download.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath Path relative to the Workspace root.
   */
  public async prepareDownload(workspaceId: string, relativePath: string): Promise<WorkspaceFileDownload> {
    const workspace = await this.resolve({ id: workspaceId });
    const safeRelative = normalizeRelativePath(relativePath);
    const absolutePath = resolveWithinRoot(workspace.cwd, safeRelative);
    let stats;
    try {
      stats = await stat(absolutePath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ApplicationError('WORKSPACE_FILE_NOT_FOUND', 'Workspace entry was not found.', {
          statusCode: 404,
          cause: error,
        });
      }
      throw new ApplicationError('WORKSPACE_FILE_DOWNLOAD_FAILED', 'Unable to prepare download.', {
        statusCode: 500,
        cause: error,
      });
    }
    if (stats.isDirectory()) {
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.directory(absolutePath, false);
      void archive.finalize();
      return { kind: 'zip', stream: archive, filename: `${basename(absolutePath)}.zip` };
    }
    return { kind: 'file', absolutePath, filename: basename(absolutePath) };
  }

  /**
   * Resolves and validates a Workspace file that is safe to expose to the text editor.
   *
   * @param workspaceId Target Workspace id.
   * @param relativePath File path relative to the Workspace root.
   */
  async #resolveEditableFile(workspaceId: string, relativePath: string): Promise<string> {
    const workspace = await this.resolve({ id: workspaceId });
    const safeRelative = normalizeRelativePath(relativePath);
    if (safeRelative.length === 0) {
      throw new ApplicationError('WORKSPACE_FILE_PATH_INVALID', 'Requested path is invalid.', {
        statusCode: 400,
      });
    }
    const absolutePath = resolveWithinRoot(workspace.cwd, safeRelative);
    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) {
        throw new ApplicationError('WORKSPACE_FILE_NOT_EDITABLE', 'Only files can be edited.', {
          statusCode: 400,
        });
      }
      if (stats.size > MAX_EDITABLE_FILE_BYTES) {
        throw new ApplicationError('WORKSPACE_FILE_TOO_LARGE', 'File is too large to edit.', {
          statusCode: 413,
        });
      }
      return absolutePath;
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      if (hasErrorCode(error, 'ENOENT')) {
        throw new ApplicationError('WORKSPACE_FILE_NOT_FOUND', 'Workspace file was not found.', {
          statusCode: 404,
          cause: error,
        });
      }
      throw new ApplicationError('WORKSPACE_FILE_STAT_FAILED', 'Unable to inspect Workspace file.', {
        statusCode: 500,
        cause: error,
      });
    }
  }

  /**
   * Reads only direct entries without probing any child directory.
   *
   * @param absoluteDir Verified absolute directory path.
   * @param relativeDir Path relative to the Workspace root.
   */
  async #readDirectory(absoluteDir: string, relativeDir: string): Promise<FileTreeEntryDto[]> {
    const dirents = await readDirectorySafely(absoluteDir);
    const sorted = dirents.slice().sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) {
        return a.name.localeCompare(b.name);
      }
      if (a.isDirectory()) {
        return -1;
      }
      return 1;
    });
    return sorted.map((dirent) => ({
      name: dirent.name,
      path: relativeDir ? posix.join(relativeDir, dirent.name) : dirent.name,
      type: dirent.isDirectory() ? 'directory' : 'file',
    }));
  }
}
