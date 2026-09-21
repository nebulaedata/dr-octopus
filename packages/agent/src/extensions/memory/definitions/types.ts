/**
 * @author Codex
 * @description Host-neutral memory types and Curator inputs.
 */
export type * from '@octopus/shared/protocol/memory';
import type { MemoryDocument, MemoryRemember, MemorySource } from '@octopus/shared/protocol/memory';
export interface CuratorInput {
  sources: MemorySource[];
  existing: MemoryDocument[];
}
export type MemoryCurator = (input: CuratorInput, signal: AbortSignal) => Promise<MemoryRemember[]>;
export interface MemoryWriteGuard {
  epoch: number;
  signal: AbortSignal;
}
