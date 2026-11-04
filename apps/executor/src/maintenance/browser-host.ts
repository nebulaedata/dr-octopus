/**
 * @author Codex
 * @description Publishes complete Browser Host bundles through a journalled stable registration and revision-bound ownership decisions.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';
import { bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
import { hostBundlePaths, hostBundleSchema } from '../contracts/browser-host-bundle';
import type { BrowserCheck, BrowserMaintenance } from '../contracts/browser-maintenance';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
type Bundle = z.infer<typeof hostBundleSchema>;
export type HostProbeOutcome = { state: 'ready' | 'waiting' | 'failed'; exitCode: number | null };
const probeFailureSchema = z.strictObject({
  bundleId: digestSchema,
  code: z.literal('HOST_START_FAILED'),
  exitCode: z.number().int().nullable(),
  at: z.iso.datetime(),
});
export const registryRecordSchema = z.strictObject({
  browser: z.enum(['chrome', 'edge']),
  hive: z.enum(['CurrentUser', 'LocalMachine']),
  view: z.enum(['Registry32', 'Registry64']),
  path: z.string().max(30000).nullable(),
  blocked: z.boolean(),
});
export type RegistryRecord = z.infer<typeof registryRecordSchema>;
export type BrowserRegistry = {
  /**
   * Reads both views and hives without changing policy or registrations.
   */
  inspect(hostName: string): Promise<RegistryRecord[]>;
  /**
   * Publishes only a current-user entry after the maintenance owner checks its revision.
   */
  set(hostName: string, record: RegistryRecord, path: string): Promise<void>;
  /**
   * Removes only a current-user entry still pointing at the supplied owned manifest.
   */
  remove(hostName: string, record: RegistryRecord, path: string): Promise<void>;
};
const ownerSchema = z.strictObject({
  source: z.string().max(30000).refine(isAbsolute),
  sourceVersion: hostBundleSchema.shape.version,
  installationBundleId: digestSchema,
  generation: z.number().int().positive(),
  bundleId: digestSchema,
  directory: z.string().regex(/^[a-f0-9]{64}-[a-f0-9-]{36}$/),
  bundle: hostBundleSchema,
});
type Owner = z.infer<typeof ownerSchema>;
const journalSchema = z.strictObject({
  operationId: z.uuid(),
  reason: z.enum(['publish', 'rollback']),
  before: z.array(registryRecordSchema).max(8),
  previous: ownerSchema.nullable(),
  target: ownerSchema,
});

/**
 * Computes stable identities for bundle inventories and read-only diagnostic revisions.
 */
export function browserDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Treats only a missing file as absent; malformed or inaccessible maintenance state must not be reset.
 */
async function readJson(path: string): Promise<unknown | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) {
      throw new Error('HOST_METADATA_INVALID');
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Replaces one small metadata file from a complete sibling, preserving the previous bytes until publication.
 */
async function publishJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx');
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

/**
 * Compares released numeric versions; the inventory explicitly rejects ambiguous prerelease order.
 */
function compareVersion(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) {
      return a[index]! - b[index]!;
    }
  }
  return 0;
}

export class BrowserHostMaintenance {
  private readonly root: string;
  private readonly manifest: string;
  private readonly state: string;
  private readonly journal: string;

  /**
   * Borrows a registry adapter. The caller must hold the same process-safe maintenance lease for every mutating call.
   */
  constructor(
    private readonly resourceRoot: string,
    private readonly projectRoot: string,
    private readonly registry: BrowserRegistry,
    private readonly probe?: (
      directory: string,
      bundleId: string,
      origins: readonly string[]
    ) => Promise<HostProbeOutcome>
  ) {
    this.root = join(projectRoot, 'browser-host');
    this.manifest = join(this.root, 'registration/native-host.json');
    this.state = join(this.root, 'state/owner.json');
    this.journal = join(this.root, 'state/transaction.json');
  }

  /**
   * Verifies every allowlisted file and forbids reparse escapes from the selected bundle root.
   */
  private async verify(directory: string, bundle: Bundle, deployed = false): Promise<boolean> {
    try {
      if (browserDigest(await readJson(join(directory, 'host-bundle.json'))) !== browserDigest(bundle)) {
        return false;
      }
      if (
        deployed &&
        browserDigest(await readJson(join(directory, 'bridge/host-location.json'))) !==
          browserDigest({ projectRoot: this.projectRoot })
      ) {
        return false;
      }
      const base = await realpath(directory);
      for (const path of hostBundlePaths) {
        const target = join(directory, path);
        const inside = relative(base, await realpath(target));
        if (inside.startsWith('..') || isAbsolute(inside) || !(await lstat(target)).isFile()) {
          return false;
        }
        if (
          createHash('sha256')
            .update(await readFile(target))
            .digest('hex') !== bundle.files[path]
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the only mutable registration to a complete immutable version directory.
   */
  private manifestFor(owner: Owner) {
    return {
      name: owner.bundle.hostName,
      description: 'Octopus Browser Bridge',
      path: join(this.root, 'versions', owner.directory, 'native/browser-launcher.exe'),
      type: 'stdio',
      allowed_origins: owner.bundle.origins,
    };
  }

  /**
   * Reads current authority and evidence once; neither a file's presence nor registration alone means connected.
   */
  private async evidence() {
    const bundle = hostBundleSchema.parse(await readJson(join(this.resourceRoot, 'host-bundle.json')));
    const source = await realpath(this.resourceRoot);
    const rawOwner = await readJson(this.state).catch(async (error: unknown) => {
      if (error instanceof SyntaxError) {
        return { invalidJson: browserDigest(await readFile(this.state, 'utf8')) };
      }
      throw error;
    });
    const parsedOwner = ownerSchema.safeParse(rawOwner);
    let owner = parsedOwner.success ? parsedOwner.data : null;
    const channelMismatch = Boolean(owner && owner.bundle.hostName !== bundle.hostName);
    const ownerIssue = rawOwner !== null && (!owner || owner.bundleId !== browserDigest(owner.bundle));
    if (ownerIssue) {
      const previous = journalSchema.safeParse(
        await readJson(join(this.root, 'state/last-transaction.json')).catch(() => null)
      );
      owner =
        previous.success &&
        previous.data.target.bundle.hostName === bundle.hostName &&
        previous.data.target.bundleId === browserDigest(previous.data.target.bundle)
          ? previous.data.target
          : null;
    }
    const records = await this.registry.inspect(bundle.hostName);
    if (records.length !== 8) {
      throw new Error('HOST_REGISTRY_INCOMPLETE');
    }
    const manifest = await readJson(this.manifest).catch(() => 'invalid');
    const journal = await readJson(this.journal).catch(async (error: unknown) => {
      if (error instanceof SyntaxError) {
        return { invalidJson: browserDigest(await readFile(this.journal, 'utf8')) };
      }
      throw error;
    });
    const failure = probeFailureSchema.safeParse(
      await readJson(join(this.root, 'state/startup-failure.json')).catch(() => null)
    );
    return {
      bundle,
      source,
      owner,
      ownerIssue,
      channelMismatch,
      ownerRevision: browserDigest(rawOwner),
      records,
      manifest,
      journal,
      failure: failure.success ? failure.data : null,
    };
  }

  /**
   * Reports registry, policy, ownership, source and deployed bytes separately; never probes page tools.
   */
  async inspect(): Promise<BrowserMaintenance> {
    const evidence = await this.evidence();
    const { bundle, owner, records, manifest } = evidence;
    const bundleId = browserDigest(bundle);
    const checks: BrowserCheck[] = [];
    let blocked = false;
    let confirmation = false;
    let repair = false;
    if (evidence.channelMismatch) {
      blocked = true;
      checks.push({
        id: 'channel',
        status: 'fail',
        code: 'HOST_CHANNEL_MISMATCH',
        expected: bundle.hostName,
        actual: owner?.bundle.hostName ?? '',
      });
    }
    if (evidence.journal !== null) {
      const pending = journalSchema.safeParse(evidence.journal);
      confirmation ||= !pending.success;
      checks.push({
        id: 'transaction',
        status: 'fail',
        code: pending.success ? 'HOST_TRANSACTION_PENDING' : 'HOST_JOURNAL_INVALID',
        expected: 'Recover or explicitly replace the recorded transaction',
        actual: pending.success
          ? `${pending.data.target.sourceVersion}:${pending.data.target.installationBundleId}`
          : browserDigest(evidence.journal),
      });
    }
    if (
      evidence.failure &&
      (evidence.failure.bundleId === bundleId || evidence.failure.bundleId === owner?.bundleId)
    ) {
      repair = true;
      checks.push({
        id: 'startup',
        status: 'fail',
        code: 'HOST_START_FAILED',
        expected: 'Read-only Host probe',
        actual: `${evidence.failure.bundleId}: exit ${evidence.failure.exitCode ?? 'unknown'}`,
      });
    }
    if (bundle.protocolVersion !== bridgeVersion) {
      blocked = true;
      checks.push({
        id: 'protocol',
        status: 'fail',
        code: 'HOST_PROTOCOL_INCOMPATIBLE',
        expected: String(bridgeVersion),
        actual: String(bundle.protocolVersion),
      });
    }
    if (evidence.ownerIssue) {
      confirmation = true;
      repair = true;
      checks.push({
        id: 'owner',
        status: 'fail',
        code: 'OWNER_RECORD_INVALID',
        expected: 'Back up the damaged record and rebuild from this installation',
        actual: evidence.ownerRevision,
      });
    }
    const sourceValid = await this.verify(this.resourceRoot, bundle);
    checks.push({
      id: 'source',
      status: sourceValid ? 'pass' : 'fail',
      code: sourceValid ? 'SOURCE_VALID' : 'SOURCE_INCOMPLETE',
      expected: bundleId,
      actual: sourceValid ? bundleId : '',
    });
    blocked ||= !sourceValid;
    for (const record of records) {
      const id = `${record.browser}.${record.hive}.${record.view}`;
      if (record.blocked) {
        blocked = true;
      }
      checks.push({
        id: `${id}.policy`,
        status: record.blocked ? 'fail' : 'pass',
        code: record.blocked ? 'POLICY_BLOCKED' : 'POLICY_CLEAR',
        expected: 'Native Messaging allowed',
        actual: record.blocked ? 'Browser policy blocks user-level Host' : '',
      });
      const owned = record.path === this.manifest;
      const foreign = record.path !== null && !owned;
      const userRegistered = records.some(
        (item) =>
          item.browser === record.browser && item.hive === 'CurrentUser' && item.path === this.manifest
      );
      if (record.hive === 'CurrentUser') {
        confirmation ||= foreign;
        repair ||= !owned;
      }
      if (record.hive === 'LocalMachine' && foreign && !userRegistered) {
        confirmation = true;
      }
      let status: BrowserCheck['status'] = 'fail';
      let code = 'REGISTRATION_MISSING';
      if (owned) {
        status = 'pass';
        code = 'REGISTERED';
      } else if (foreign) {
        code = 'REGISTRATION_CONFLICT';
      } else if (record.hive === 'LocalMachine') {
        status = 'notApplicable';
      }
      if (record.hive === 'LocalMachine' && userRegistered && foreign) {
        status = 'notApplicable';
        code = 'SHADOWED_MACHINE_REGISTRATION';
      }
      checks.push({ id, status, code, expected: this.manifest, actual: record.path ?? '' });
    }
    const deployed =
      owner && (await this.verify(join(this.root, 'versions', owner.directory), owner.bundle, true));
    const locator = owner
      ? await readJson(join(this.root, 'versions', owner.directory, 'bridge/host-location.json')).catch(
          () => null
        )
      : null;
    const manifestValid = owner && browserDigest(manifest) === browserDigest(this.manifestFor(owner));
    const deployedValid = Boolean(
      deployed && browserDigest(locator) === browserDigest({ projectRoot: this.projectRoot })
    );
    checks.push({
      id: 'bundle',
      status: deployedValid ? 'pass' : 'fail',
      code: deployedValid ? 'BUNDLE_VALID' : 'BUNDLE_MISSING_OR_DAMAGED',
      expected: owner?.bundleId ?? bundleId,
      actual: deployedValid ? owner!.bundleId : '',
    });
    checks.push({
      id: 'manifest',
      status: manifestValid ? 'pass' : 'fail',
      code: manifestValid ? 'MANIFEST_VALID' : 'MANIFEST_INVALID',
      expected: this.manifest,
      actual: manifestValid ? this.manifest : '',
    });
    repair ||= !deployedValid || !manifestValid || evidence.journal !== null;
    repair ||= Boolean(owner && owner.source !== evidence.source);
    if (owner && owner.installationBundleId !== bundleId) {
      const newer = compareVersion(bundle.version, owner.sourceVersion) > 0;
      const dev = bundle.hostName.includes('.dev_') && owner.source === evidence.source;
      confirmation ||= !newer && !dev;
      repair = true;
      checks.push({
        id: 'owner',
        status: 'fail',
        code: newer || dev ? 'UPDATE_AVAILABLE' : 'OWNER_CONFIRMATION_REQUIRED',
        expected: `${bundle.version}:${bundleId}`,
        actual: `${owner.sourceVersion}:${owner.installationBundleId}`,
      });
    }
    if (owner && owner.installationBundleId === bundleId && owner.bundleId !== bundleId) {
      repair = true;
      checks.push({
        id: 'active-bundle',
        status: 'fail',
        code: 'ROLLBACK_ACTIVE',
        expected: bundleId,
        actual: owner.bundleId,
      });
    }
    let phase: BrowserMaintenance['phase'] = 'ready';
    if (blocked) {
      phase = 'blocked';
    } else if (confirmation) {
      phase = 'confirmationRequired';
    } else if (repair) {
      phase = 'repairable';
    }
    return {
      revision: browserDigest({ evidence, checks }),
      at: new Date().toISOString(),
      phase,
      hostName: bundle.hostName,
      bundleId,
      checks,
    };
  }

  /**
   * Completes a previously journalled publication only while every affected registration remains unchanged or owned.
   */
  private async recover(hostName: string): Promise<void> {
    const raw = await readJson(this.journal);
    if (raw === null) {
      return;
    }
    const journal = journalSchema.parse(raw);
    if (
      journal.target.bundle.hostName !== hostName ||
      journal.target.bundleId !== browserDigest(journal.target.bundle) ||
      (journal.previous &&
        (journal.previous.bundle.hostName !== hostName ||
          journal.previous.bundleId !== browserDigest(journal.previous.bundle)))
    ) {
      throw new Error('HOST_JOURNAL_INVALID');
    }
    const records = await this.registry.inspect(journal.target.bundle.hostName);
    for (const record of records.filter((item) => item.hive === 'CurrentUser')) {
      const before = journal.before.find(
        (item) => item.browser === record.browser && item.hive === record.hive && item.view === record.view
      );
      if (!before || (record.path !== this.manifest && record.path !== before.path) || record.blocked) {
        throw new Error('HOST_RECOVERY_CONFLICT');
      }
    }
    let target = journal.target;
    if (!(await this.verify(join(this.root, 'versions', target.directory), target.bundle, true))) {
      if (
        !journal.previous ||
        journal.previous.bundle.protocolVersion !== target.bundle.protocolVersion ||
        !(await this.verify(
          join(this.root, 'versions', journal.previous.directory),
          journal.previous.bundle,
          true
        ))
      ) {
        throw new Error('HOST_RECOVERY_BUNDLE_UNAVAILABLE');
      }
      target = {
        ...journal.previous,
        source: journal.target.source,
        sourceVersion: journal.target.sourceVersion,
        installationBundleId: journal.target.installationBundleId,
        generation: journal.target.generation,
      };
    }
    await publishJson(this.manifest, this.manifestFor(target));
    for (const record of records.filter((item) => item.hive === 'CurrentUser')) {
      await this.registry.set(target.bundle.hostName, record, this.manifest);
    }
    const verified = await this.registry.inspect(target.bundle.hostName);
    if (verified.some((item) => item.hive === 'CurrentUser' && item.path !== this.manifest)) {
      throw new Error('HOST_REGISTRY_READBACK_FAILED');
    }
    await publishJson(this.state, target);
    await publishJson(join(this.root, 'state', `history-${journal.operationId}.json`), journal);
    await rename(this.journal, join(this.root, 'state/last-transaction.json'));
    await this.prune(target, journal.previous);
  }

  /**
   * Retains the current and previous bundles plus twenty transaction records; occupied old bundles are left for a later pass.
   */
  private async prune(current: Owner, previous: Owner | null): Promise<void> {
    const versions = join(this.root, 'versions');
    const keep = new Set([current.directory, previous?.directory]);
    for (const entry of (await readdir(versions, { withFileTypes: true })).slice(0, 100)) {
      if (
        !entry.isDirectory() ||
        keep.has(entry.name) ||
        !ownerSchema.shape.directory.safeParse(entry.name).success
      ) {
        continue;
      }
      try {
        await rm(join(versions, entry.name), { recursive: true });
      } catch (error) {
        // Loaded Windows executables may remain pinned. Publication is already complete; retry cleanup next time.
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(String(error.code))
        )) {
          throw error;
        }
      }
    }
    const state = join(this.root, 'state');
    const history = (await readdir(state)).filter((name) =>
      /^(?:history|owner-backup|probe|abandoned)-[a-f0-9-]{36}\.json$/.test(name)
    );
    const dated = await Promise.all(
      history.map(async (name) => ({ name, modified: (await lstat(join(state, name))).mtimeMs }))
    );
    for (const record of dated.sort((a, b) => b.modified - a.modified).slice(20)) {
      await unlink(join(state, record.name));
    }
  }

  /**
   * Publishes a verified complete bundle. Confirmation is bound to the exact evidence re-read under the caller's lease.
   */
  async repair(input?: { revision: string; confirmReplacement: boolean }): Promise<BrowserMaintenance> {
    if (!this.probe) {
      throw new Error('HOST_PROBE_UNAVAILABLE');
    }
    const initial = await this.inspect();
    if (input && input.revision !== initial.revision) {
      throw new Error('HOST_DIAGNOSTICS_CHANGED');
    }
    if (initial.phase === 'blocked') {
      throw new Error('HOST_REPAIR_BLOCKED');
    }
    if (initial.phase === 'confirmationRequired' && !input?.confirmReplacement) {
      throw new Error('HOST_CONFIRMATION_REQUIRED');
    }
    for (const directory of ['registration', 'versions', 'state']) {
      await mkdir(join(this.root, directory), { recursive: true });
    }
    let rebased = false;
    const approved = await this.evidence();
    if (initial.phase === 'confirmationRequired' && input?.confirmReplacement && approved.journal !== null) {
      await rename(this.journal, join(this.root, 'state', `abandoned-${randomUUID()}.json`));
      const after = await this.evidence();
      if (browserDigest({ ...approved, journal: null }) !== browserDigest(after)) {
        throw new Error('HOST_DIAGNOSTICS_CHANGED');
      }
      rebased = true;
    }
    if ((await this.evidence()).ownerIssue) {
      await copyFile(this.state, join(this.root, 'state', 'owner-backup-' + randomUUID() + '.json'));
    }
    await this.recover(initial.hostName);
    const current = await this.inspect();
    if (current.phase === 'blocked') {
      throw new Error('HOST_REPAIR_BLOCKED');
    }
    if (current.phase === 'confirmationRequired' && current.revision !== initial.revision && !rebased) {
      throw new Error('HOST_DIAGNOSTICS_CHANGED');
    }
    const { bundle, source, owner, records } = await this.evidence();
    const bundleId = browserDigest(bundle);
    if (bundleId !== current.bundleId) {
      throw new Error('HOST_DIAGNOSTICS_CHANGED');
    }
    if (current.phase === 'ready' && owner) {
      const probe = await this.probe(
        join(this.root, 'versions', owner.directory),
        owner.bundleId,
        owner.bundle.origins
      );
      if (probe.state !== 'failed') {
        return current;
      }
      await this.recordProbeFailure(owner.bundleId, probe);
      return this.rollback(owner, bundle, source, records);
    }
    const directory = `${bundleId}-${randomUUID()}`;
    const staging = join(this.root, 'versions', directory);
    let journaled = false;
    try {
      for (const path of hostBundlePaths) {
        const target = join(staging, path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(this.resourceRoot, path), target);
      }
      await writeFile(
        join(staging, 'bridge/host-location.json'),
        JSON.stringify({ projectRoot: this.projectRoot }),
        { flag: 'wx' }
      );
      await writeFile(join(staging, 'host-bundle.json'), JSON.stringify(bundle), { flag: 'wx' });
      if (!(await this.verify(staging, bundle, true))) {
        throw new Error('HOST_STAGING_INVALID');
      }
      const probe = await this.probe(staging, bundleId, bundle.origins);
      if (probe.state === 'failed') {
        await this.recordProbeFailure(bundleId, probe);
        if (owner) {
          return this.rollback(
            owner,
            bundle,
            source,
            records,
            owner.bundleId !== bundleId ? owner : undefined
          );
        }
        throw new Error('HOST_START_FAILED');
      }
      const target: Owner = {
        source,
        sourceVersion: bundle.version,
        installationBundleId: bundleId,
        generation: (owner?.generation ?? 0) + 1,
        directory,
        bundleId,
        bundle,
      };
      await publishJson(this.journal, {
        operationId: randomUUID(),
        reason: 'publish',
        before: records,
        previous: owner,
        target,
      });
      journaled = true;
      await this.recover(initial.hostName);
      await rm(join(this.root, 'state/startup-failure.json'), { force: true });
      return this.inspect();
    } finally {
      if (!journaled) {
        await rm(staging, { recursive: true, force: true }).catch(() =>
          console.warn('HOST_STAGING_CLEANUP_PENDING')
        );
      }
    }
  }

  /**
   * Keeps failed launch evidence outside ownership state; it cannot grant write authority or enable a browser.
   */
  private async recordProbeFailure(bundleId: string, outcome: HostProbeOutcome): Promise<void> {
    const failure = {
      bundleId,
      code: 'HOST_START_FAILED',
      exitCode: outcome.exitCode,
      at: new Date().toISOString(),
    };
    await publishJson(join(this.root, 'state/startup-failure.json'), failure);
    await publishJson(join(this.root, 'state', `probe-${randomUUID()}.json`), failure);
  }

  /**
   * Re-activates only a verified previous bundle in the current protocol while retaining the newer installation's ownership.
   */
  private async rollback(
    owner: Owner,
    bundle: Bundle,
    source: string,
    records: RegistryRecord[],
    retained?: Owner
  ): Promise<BrowserMaintenance> {
    const last = retained
      ? null
      : journalSchema.safeParse(
          await readJson(join(this.root, 'state/last-transaction.json')).catch(() => null)
        );
    const previous = retained ?? (last?.success ? last.data.previous : null);
    if (
      !previous ||
      previous.bundle.protocolVersion !== bundle.protocolVersion ||
      !(await this.verify(join(this.root, 'versions', previous.directory), previous.bundle, true)) ||
      !this.probe
    ) {
      throw new Error('HOST_START_FAILED');
    }
    const outcome = await this.probe(
      join(this.root, 'versions', previous.directory),
      previous.bundleId,
      previous.bundle.origins
    );
    if (outcome.state === 'failed') {
      throw new Error('HOST_START_FAILED');
    }
    const target: Owner = {
      ...previous,
      source,
      sourceVersion: bundle.version,
      installationBundleId: browserDigest(bundle),
      generation: owner.generation + 1,
    };
    await publishJson(this.journal, {
      operationId: randomUUID(),
      reason: 'rollback',
      before: records,
      previous: owner,
      target,
    });
    await this.recover(bundle.hostName);
    return this.inspect();
  }

  /**
   * Unregisters only the current installation's exact build; older uninstallers cannot remove its replacement.
   */
  async remove(): Promise<void> {
    const { source, owner, bundle, records } = await this.evidence();
    if (
      !owner ||
      owner.bundle.hostName !== bundle.hostName ||
      owner.source !== source ||
      owner.installationBundleId !== browserDigest(bundle)
    ) {
      return;
    }
    for (const record of records.filter((item) => item.hive === 'CurrentUser')) {
      await this.registry.remove(bundle.hostName, record, this.manifest);
    }
    await unlink(this.state);
  }
}
