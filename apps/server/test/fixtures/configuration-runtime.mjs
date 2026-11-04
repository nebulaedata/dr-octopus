/**
 * @author Codex
 * @description Owns explicit configuration resources for isolated runtime test fixtures.
 */
import { ConfigurationChanges } from '../../dist/infrastructure/runtime-config/index.js';
import { SessionRuntimeCoordinator } from '../../dist/infrastructure/runtime/index.js';
const resources = new WeakMap();
/**
 * Creates a runtime and closes its fixture-owned resource after runtime teardown.
 */
export function createTestCoordinator(options = {}) {
  const configurationChanges = new ConfigurationChanges();
  const runtime = new SessionRuntimeCoordinator({ ...options, configurationChanges });
  resources.set(runtime, configurationChanges);
  const close = runtime.close.bind(runtime);
  runtime.close = async () => {
    try {
      await close();
    } finally {
      configurationChanges.close();
    }
  };
  return runtime;
}
/**
 * Returns the fixture's explicitly owned configuration resource.
 */
export function configurationFor(runtime) {
  return resources.get(runtime);
}
