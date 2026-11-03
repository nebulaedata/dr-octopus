/**
 * @author Codex
 * @description Owns installation-isolated browser skill snapshots and idempotent publication inside the fixed Executor project root.
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  browserSkillPackageSchema,
  browserSkillReceiptSchema,
  type BrowserSkillPackage,
  type BrowserSkillReceipt,
  type BrowserSkillSnapshot,
} from '@octopus/shared/protocol/browser-skills';
import type { NativeFileCommit } from '../basic/native-file-commit';

/**
 * Hashes both definition files with length framing so boundaries cannot collide.
 */
function definitionHash(markdown: string, workflow: string): string {
  return createHash('sha256')
    .update(String(Buffer.byteLength(markdown)))
    .update(':')
    .update(markdown)
    .update(workflow)
    .digest('hex');
}

export class BrowserSkillFiles {
  private readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Uses only trusted Host configuration; extension commands never supply the library path.
   */
  constructor(
    private readonly native: NativeFileCommit,
    private readonly projectRoot: string
  ) {
    this.root = join(projectRoot, 'skills', 'browser-recordings');
  }

  /**
   * Validates an ordinary directory through the pinned native backend before creating or reading children.
   */
  private async directory(path: string, create = false): Promise<void> {
    let info = await this.native.inspect(path);
    if (!info.ok && create && [2, 3].includes(info.nativeCode)) {
      const created = await this.native.createSkillDirectory(path);
      if (!created.ok) {
        throw new Error('SKILL_STORAGE');
      }
      info = await this.native.inspect(path);
    }
    if (!info.ok || !info.directory) {
      throw new Error([2, 3].includes(info.nativeCode) ? 'SKILL_MISSING' : 'SKILL_PATH');
    }
  }

  /**
   * Resolves an authenticated installation's fixed namespace, rejecting reparse ancestors at every native boundary.
   */
  private async installation(installationId: string, create = false): Promise<string> {
    z.uuid().parse(installationId);
    await this.directory(this.projectRoot);
    await this.directory(join(this.projectRoot, 'skills'), create);
    await this.directory(this.root, create);
    const path = join(this.root, installationId);
    await this.directory(path, create);
    return path;
  }

  /**
   * Reads bounded bytes while native handles pin ordinary ancestors and reject reparse points.
   */
  private async text(path: string, maximum: number): Promise<string> {
    const result = await this.native.readSnapshot(path);
    if (!result.ok) {
      throw new Error([2, 3].includes(result.nativeCode) ? 'SKILL_MISSING' : 'SKILL_PATH');
    }
    if (result.bytes.length > maximum) {
      throw new Error('SKILL_INVALID');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
  }

  /**
   * Resolves an earlier operation without modifying a manually edited definition.
   */
  async receipt(installationId: string, operationId: string): Promise<BrowserSkillReceipt | null> {
    z.uuid().parse(operationId);
    try {
      const root = await this.installation(installationId);
      await this.directory(join(root, operationId));
      const result = browserSkillReceiptSchema.parse(
        JSON.parse(await this.text(join(root, operationId, '.receipt.json'), 4096))
      );
      if (result.operationId !== operationId || result.skillId !== operationId) {
        throw new Error('SKILL_CONFLICT');
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'SKILL_MISSING') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Reads a stable two-file snapshot; hash stability does not claim the user's editing batch is complete.
   */
  async read(installationId: string, skillId: string): Promise<BrowserSkillSnapshot> {
    z.uuid().parse(skillId);
    const path = join(await this.installation(installationId), skillId);
    await this.directory(path);
    const markdown = await this.text(join(path, 'SKILL.md'), 65536);
    const workflow = await this.text(join(path, 'workflow.json'), 32768);
    const againMarkdown = await this.text(join(path, 'SKILL.md'), 65536);
    const againWorkflow = await this.text(join(path, 'workflow.json'), 32768);
    if (markdown !== againMarkdown || workflow !== againWorkflow) {
      throw new Error('SKILL_CHANGED');
    }
    const parsed = browserSkillPackageSchema.safeParse({
      skillMarkdown: markdown,
      workflow: JSON.parse(workflow),
    });
    if (!parsed.success) {
      throw new Error('SKILL_INVALID');
    }
    return { skillId, definitionHash: definitionHash(markdown, workflow), candidate: parsed.data };
  }

  /**
   * Verifies the directory before trusted Main receives its installation and skill identifiers.
   */
  async directoryPath(installationId: string, skillId: string): Promise<string> {
    z.uuid().parse(skillId);
    const path = join(await this.installation(installationId), skillId);
    await this.directory(path);
    return path;
  }

  /**
   * Serializes create operations; an operation ID always identifies the same immutable initial package.
   */
  create(
    installationId: string,
    operationId: string,
    raw: BrowserSkillPackage
  ): Promise<BrowserSkillReceipt> {
    const next = this.queue.then(() => this.publish(installationId, operationId, raw));
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Writes a new file once, or verifies the identical bytes left by an interrupted save.
   */
  private async writeOnce(path: string, text: string): Promise<void> {
    const info = await this.native.inspect(path);
    if (info.ok) {
      if (info.directory || (await this.text(path, 65536)) !== text) {
        throw new Error('SKILL_CONFLICT');
      }
      return;
    }
    if (![2, 3].includes(info.nativeCode)) {
      throw new Error('SKILL_PATH');
    }
    if (!(await this.native.writePrivateConfig(path, text)).ok) {
      throw new Error('SKILL_STORAGE');
    }
  }

  /**
   * Serializes deletion with publication; missing files are an idempotent success after a lost reply.
   * Extra user files and links are refused rather than recursively removed.
   */
  remove(installationId: string, skillId: string): Promise<{ deleted: true }> {
    const next = this.queue.then(async (): Promise<{ deleted: true }> => {
      z.uuid().parse(skillId);
      try {
        const root = await this.installation(installationId);
        for (const name of [skillId, '.' + skillId + '.pending']) {
          const result = await this.native.deleteSkillDirectory(join(root, name));
          if (!result.ok && ![2, 3].includes(result.nativeCode)) {
            throw new Error('SKILL_STORAGE');
          }
        }
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'SKILL_MISSING') {
          throw error;
        }
      }
      return { deleted: true };
    });
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Publishes a complete new directory; receipts survive a dropped Native response and are never regenerated from edited files.
   */
  private async publish(
    installationId: string,
    operationId: string,
    raw: BrowserSkillPackage
  ): Promise<BrowserSkillReceipt> {
    z.uuid().parse(operationId);
    const candidate = browserSkillPackageSchema.parse(raw);
    const markdown = candidate.skillMarkdown;
    const workflow = JSON.stringify(candidate.workflow, null, 2);
    if (workflow.length > 30000 || Buffer.byteLength(workflow) > 32768) {
      throw new Error('SKILL_INVALID');
    }
    const hash = definitionHash(markdown, workflow);
    const previous = await this.receipt(installationId, operationId);
    if (previous) {
      if (previous.definitionHash !== hash) {
        throw new Error('SKILL_CONFLICT');
      }
      return previous;
    }
    const root = await this.installation(installationId, true);
    const target = join(root, operationId);
    const existing = await this.native.inspect(target);
    if (existing.ok) {
      throw new Error('SKILL_CONFLICT');
    }
    if (![2, 3].includes(existing.nativeCode)) {
      throw new Error('SKILL_PATH');
    }
    const staging = join(root, '.' + operationId + '.pending');
    await this.directory(staging, true);
    const receipt = { operationId, skillId: operationId, definitionHash: hash };
    await this.writeOnce(join(staging, 'SKILL.md'), markdown);
    await this.writeOnce(join(staging, 'workflow.json'), workflow);
    await this.writeOnce(join(staging, '.receipt.json'), JSON.stringify(receipt));
    await this.directory(root);
    await this.directory(staging);
    if ((await this.native.inspect(target)).ok) {
      throw new Error('SKILL_CONFLICT');
    }
    const published = await this.native.publishSkillDirectory(staging, target);
    if (!published.ok) {
      throw new Error(published.started ? 'SKILL_STORAGE' : 'SKILL_CONFLICT');
    }
    await this.directory(target);
    return receipt;
  }
}
