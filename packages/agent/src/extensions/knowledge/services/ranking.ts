/**
 * @author Codex
 * @description Rank fusion independent of model scores, provider scales and storage implementation.
 */
import type { IndexedChunk } from '../definitions/types.js';

/**
 * Merge source rankings using reciprocal rank fusion and deterministic tie-breaking.
 */
export function fuseRanks(lists: IndexedChunk[][], limit = 40): IndexedChunk[] {
  const candidates = new Map<string, { chunk: IndexedChunk; score: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((chunk, index) => {
      if (seen.has(chunk.chunkId)) {
        return;
      }
      seen.add(chunk.chunkId);
      const entry = candidates.get(chunk.chunkId) ?? { chunk, score: 0 };
      entry.score += 1 / (60 + index + 1);
      candidates.set(chunk.chunkId, entry);
    });
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId))
    .slice(0, limit)
    .map((entry) => entry.chunk);
}
