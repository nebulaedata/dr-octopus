/**
 * @author Codex
 * @description Evaluates process readiness from the database and Session Runtime plugin dependencies.
 */

import type { FastifyInstance } from 'fastify';

export interface HealthReadiness {
  status: 'ready' | 'not-ready';
  database: 'ready' | 'unavailable';
  agentManager: 'ready' | 'unavailable';
  fileLogging: 'disabled' | 'healthy' | 'degraded';
}

/**
 * Owns dependency probes so HTTP composition does not pass infrastructure callbacks between layers.
 */
export class HealthService {
  /**
   * @param server Fastify instance exposing application plugins.
   */
  public constructor(protected readonly server: FastifyInstance) {}

  /**
   * Returns a failure-isolated snapshot of all dependencies required to accept requests.
   */
  public getReadiness(): HealthReadiness {
    const databaseReady = runReadinessProbe(() => this.probeDatabase());
    const agentManagerReady = runReadinessProbe(() => this.server.sessionRuntime.isAcceptingRequests());
    const fileLogging = this.server.logging.getHealth();
    const fileLoggingReady = fileLogging.state !== 'degraded' || !fileLogging.required;
    const ready = databaseReady && agentManagerReady && fileLoggingReady;

    return {
      status: ready ? 'ready' : 'not-ready',
      database: databaseReady ? 'ready' : 'unavailable',
      agentManager: agentManagerReady ? 'ready' : 'unavailable',
      fileLogging: fileLogging.state,
    };
  }

  /**
   * Executes a live SQLite round trip so readiness reflects the current connection state.
   */
  private probeDatabase(): boolean {
    const { sqlite } = this.server.database;
    if (!sqlite.open) {
      return false;
    }
    sqlite.prepare('SELECT 1').get();
    return true;
  }
}

/**
 * Converts probe failures into an unavailable state without leaking infrastructure errors.
 */
function runReadinessProbe(probe: () => boolean): boolean {
  try {
    return probe();
  } catch {
    return false;
  }
}
