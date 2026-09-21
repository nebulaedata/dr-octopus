/**
 * @author Codex
 * @description Publishes the lightweight Gateway management API independently of the business runtime.
 */

export { gatewayError, gatewayPaths, isProcessAlive } from './protocol.js';
export { getGatewayStatus, readGatewayIdentity, requestGateway } from './client.js';
export type { GatewayIdentity, GatewayPaths, GatewayStatus } from './protocol.js';
