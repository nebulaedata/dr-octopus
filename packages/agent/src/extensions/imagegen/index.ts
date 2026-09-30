/**
 * @author Codex
 * @description Exposes shared image configuration, catalog and inline extension composition.
 */
export { createImagegenExtension } from './extension/index.js';
export {
  readImagegenConfig,
  readImagegenSettings,
  updateImagegenSettings,
  ImagegenSettingsError,
} from './lib/configuration.js';
