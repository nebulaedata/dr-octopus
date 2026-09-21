/**
 * @author Codex
 * @description Knowledge service discovery and lifecycle results safe for CLI and Settings clients.
 */
export interface KnowledgeServiceStatus {
  schemaVersion: 1;
  state: 'absent' | 'stopped' | 'starting' | 'running' | 'stopping' | 'unavailable';
  health: 'ready' | 'degraded' | 'unavailable' | 'unknown';
  profileId?: string;
  daemonId?: string;
  pid?: number;
  autostartSuppressed: boolean;
  uptimeMs?: number;
  controlRevision?: number;
  checks?: { name: string; status: 'pass' | 'warn' | 'fail' | 'not-configured'; reason?: string }[];
  jobs?: { queued: number; running: number };
}

export interface KnowledgeEndpoint {
  protocolVersion: 1;
  profileId: string;
  daemonId: string;
  port: number;
}

export interface KnowledgeControl {
  stopped: boolean;
  revision: number;
}
