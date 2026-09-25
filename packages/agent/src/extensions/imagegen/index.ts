/**
 * @author Codex
 * @description Exposes shared image configuration, catalog and inline extension composition.
 */
export { createImagegenExtension } from './extension/index.js';
export { readImagegenConfig, saveImagegenConfig } from './lib/configuration.js';
export { getImagegenCatalog } from './lib/catalog.js';
