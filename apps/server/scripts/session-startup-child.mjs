/**
 * @author Codex
 * @description Measures the production Agent entry phases without changing Agent sources or RPC stdout.
 */
import { performance } from 'node:perf_hooks';

const started = performance.now();
const { initializeAgentEnvironment } = await import('../../../packages/agent/dist/utils/environment.js');
initializeAgentEnvironment();
const environmentReady = performance.now();
const { runOctopusCli } = await import('../../../packages/agent/dist/cli/run-cli.js');
const importsReady = performance.now();
process.stderr.write(
  `SESSION_PROFILE ${JSON.stringify({
    environmentMs: environmentReady - started,
    cliImportMs: importsReady - environmentReady,
    entryToCliMs: importsReady - started,
  })}\n`
);
const { DefaultResourceLoader, ModelRuntime, AgentSession, ExtensionRunner } =
  await import('@earendil-works/pi-coding-agent');

/**
 * Measures public SDK boundaries in this isolated child; diagnostic records stay on stderr.
 */
function instrument(target, method, label = method) {
  const original = target[method];
  target[method] = async function (...args) {
    const start = performance.now();
    try {
      return await original.apply(this, args);
    } finally {
      process.stderr.write(
        `SESSION_SPAN ${JSON.stringify({
          stage: typeof label === 'function' ? label(...args) : label,
          startMs: start - started,
          durationMs: performance.now() - start,
        })}\n`
      );
    }
  };
}
instrument(DefaultResourceLoader.prototype, 'reload', 'resources.reload');
instrument(ModelRuntime, 'create', 'models.create');
instrument(ModelRuntime.prototype, 'refresh', 'models.refresh');
instrument(AgentSession.prototype, 'bindExtensions', 'extensions.bind');
instrument(ExtensionRunner.prototype, 'emit', (event) => `extensions.event.${event.type}`);
await runOctopusCli([
  ...process.argv.slice(2),
  ...(process.env.SESSION_PROFILE_MODE === 'no-external-extensions' ? ['--no-extensions'] : []),
]);
