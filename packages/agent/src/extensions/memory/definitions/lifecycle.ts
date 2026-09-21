/**
 * @author Codex
 * @description Memory daemon discovery metadata and browser-safe service status.
 */
export type { MemoryServiceStatus } from '@octopus/shared/protocol/memory';
export interface MemoryEndpoint {
  protocolVersion: 1;
  profileId: string;
  daemonId: string;
  port: number;
}
export interface MemoryControl {
  stopped: boolean;
  revision: number;
}
