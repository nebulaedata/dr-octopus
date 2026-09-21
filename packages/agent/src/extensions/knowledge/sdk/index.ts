/**
 * @author Codex
 * @description Public lightweight knowledge integration surface for CLI, RPC and application Hosts.
 */
export { createKnowledgeClient } from './client.js';
export { withStoppedKnowledgeService } from './maintenance.js';
export { issueKnowledgeImportTicket } from './import-ticket.js';
export { createKnowledgeReadTools } from './tools.js';
export {
  getKnowledgeServiceStatus,
  startKnowledgeService,
  stopKnowledgeService,
  restartKnowledgeService,
  checkKnowledgeServiceHealth,
} from './lifecycle.js';
export { KnowledgeError } from '../definitions/error.js';
export type { KnowledgeClient, KnowledgeClientOptions, KnowledgeOperations } from '../definitions/client.js';
export type { KnowledgeServiceStatus } from '../definitions/lifecycle.js';
export type * from '../definitions/types.js';
export type * from '../definitions/models.js';
