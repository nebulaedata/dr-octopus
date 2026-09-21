/**
 * @author Codex
 * @description Exposes the built-in Scheduler extension factory without exporting transport internals.
 */
export { createSchedulerExtension, default } from './extension/index.js';
export { createSchedulerClient, AgentSchedulerClient } from './sdk/client.js';
export type { SchedulerClientOptions } from './sdk/client.js';
