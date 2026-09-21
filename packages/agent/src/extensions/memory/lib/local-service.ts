/**
 * @author Codex
 * @description Assemble the public memory Service and product-global default paths without eager I/O.
 */
import { createHash } from 'node:crypto';
import { resolveMemoryPaths } from './paths.js';
import { createMemoryRepository } from './repository.js';
import { memoryService } from '../services/memory-service.js';
/**
 * Create an isolated Service; dataRoot is a trusted composition/test option, never a model argument.
 */
export function createLocalMemoryService(
  options: { dataRoot?: string; migrationsFolder?: string; readOnly?: boolean } = {}
) {
  const paths = resolveMemoryPaths(options.dataRoot);
  return memoryService(
    createMemoryRepository(paths.directory, options.migrationsFolder),
    (value) => createHash('sha256').update(value).digest('hex'),
    options.readOnly
  );
}
export { resolveMemoryPaths };
export type { MemoryService } from '../services/memory-service.js';
export { MemoryError } from '../definitions/error.js';
