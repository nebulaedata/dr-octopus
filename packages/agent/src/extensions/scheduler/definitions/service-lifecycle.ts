/**
 * @author Codex
 * @description Public lifecycle status distinguishes platform readiness from executable scheduler readiness.
 */
export interface SchedulerEndpoint {
  protocol: 3;
  profileId: string;
  daemonId: string;
  port: number;
  pid: number;
}

export interface SchedulerControl {
  stopped: boolean;
  revision: number;
}

export type SchedulerServiceStatus =
  | {
      state: 'absent' | 'stopped' | 'unavailable';
    }
  | (SchedulerEndpoint & {
      state: 'control-ready';
      taskControlReady: true;
      executionReady: boolean;
      active: boolean;
      degraded: boolean;
      lastScanAt: string | null;
      queued: number;
      running: number;
      nextRunAt: string | null;
    });
