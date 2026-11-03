/**
 * @author Codex
 * @description Validates immutable browser Skill copies and computes the same canonical creation hash as the file service.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { z } from 'zod';
import {
  browserSkillPackageSchema,
  browserSkillSnapshotSchema,
  type BrowserSkillPackage,
  type BrowserSkillSnapshot,
} from '@octopus/shared/protocol/browser-skills';

const cacheSchema = z.strictObject({
  snapshot: browserSkillSnapshotSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  cachedAt: z.number().finite(),
});
export type SkillCache = z.infer<typeof cacheSchema>;

/**
 * Computes canonical content identity; names never become paths.
 */
export function skillContentHash(raw: BrowserSkillPackage): string {
  const candidate = browserSkillPackageSchema.parse(raw);
  const encoder = new TextEncoder();
  return bytesToHex(
    sha256(
      encoder.encode(
        String(encoder.encode(candidate.skillMarkdown).length) +
          ':' +
          candidate.skillMarkdown +
          JSON.stringify(candidate.workflow, null, 2)
      )
    )
  );
}

/**
 * Records when a complete validated snapshot became locally available.
 */
export function cacheSkill(snapshot: BrowserSkillSnapshot, cachedAt = Date.now()): SkillCache {
  const parsed = browserSkillSnapshotSchema.parse(snapshot);
  return { snapshot: parsed, contentHash: skillContentHash(parsed.candidate), cachedAt };
}

/**
 * Rejects missing, changed or corrupt browser copies before any export or replay.
 */
export function readSkillCache(raw: unknown): SkillCache {
  const parsed = cacheSchema.safeParse(raw);
  if (!parsed.success || parsed.data.contentHash !== skillContentHash(parsed.data.snapshot.candidate)) {
    throw new Error('SKILL_NO_BROWSER_COPY');
  }
  return parsed.data;
}
