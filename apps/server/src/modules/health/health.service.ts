/**
 * @author Codex
 * @description Evaluates process readiness from the database and Session Runtime plugin dependencies.
 */
export interface HealthProbes {
  /**
   * Checks the shared database connection.
   */
  database(this: void): boolean;
  /**
   * Checks runtime request admission.
   */
  runtime(this: void): boolean;
  /**
   * Returns current logging health without changing logger state.
   */
  logging(this: void): { state: 'disabled' | 'healthy' | 'degraded'; required: boolean };
}

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
  public constructor(private readonly probes: HealthProbes) {}

  /**
   * Returns a failure-isolated snapshot of all dependencies required to accept requests.
   */
  public getReadiness(): HealthReadiness {
    const databaseReady = runReadinessProbe(this.probes.database);
    const agentManagerReady = runReadinessProbe(this.probes.runtime);
    const fileLogging = this.probes.logging();
    const fileLoggingReady = fileLogging.state !== 'degraded' || !fileLogging.required;
    const ready = databaseReady && agentManagerReady && fileLoggingReady;

    return {
      status: ready ? 'ready' : 'not-ready',
      database: databaseReady ? 'ready' : 'unavailable',
      agentManager: agentManagerReady ? 'ready' : 'unavailable',
      fileLogging: fileLogging.state,
    };
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
