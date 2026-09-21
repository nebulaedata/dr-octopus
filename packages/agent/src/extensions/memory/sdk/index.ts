/**
 * @author Codex
 * @description Assemble the public memory Service and product-global default paths without eager I/O.
 */
import { createMemoryClient } from './client.js';
import { resolveMemoryPaths } from '../lib/paths.js';
/**
 * Create an isolated Service; dataRoot is a trusted composition/test option, never a model argument.
 */
export function createMemoryService(
  options: { dataRoot?: string; migrationsFolder?: string; readOnly?: boolean } = {}
) {
  return createMemoryClient(options);
}
export { resolveMemoryPaths };
export type { MemoryService } from '../services/memory-service.js';
export { MemoryError } from '../definitions/error.js';
export {
  getMemoryServiceStatus,
  startMemoryService,
  stopMemoryService,
  restartMemoryService,
  checkMemoryServiceHealth,
} from './lifecycle.js';
