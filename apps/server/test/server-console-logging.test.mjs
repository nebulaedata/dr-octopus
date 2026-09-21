/**
 * @author Codex
 * @description Verifies readable monochrome production terminal logs and structured redirected output.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

/**
 * Exercises the real Pino destination in an isolated process with deterministic terminal detection.
 */
function renderLog(tty, pretty) {
  const moduleUrl = new URL('../dist/lib/logging/server-log-options.js', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createStdoutDestination, createServerLogOptions } from ${JSON.stringify(moduleUrl)};
    import pino from 'pino';
    Object.defineProperty(process.stdout, 'isTTY', { value: ${tty} });
    const logger = pino(createServerLogOptions('info'), createStdoutDestination(${pretty}));
    logger.info({ phase: 'ready', details: { port: 3000 }, password: 'must-not-leak' }, 'Gateway is ready');
    logger.error({ err: new Error('fixture failure') }, 'Request failed');
  `,
    ],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8', windowsHide: true, timeout: 10000 }
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.doesNotMatch(result.stdout, /must-not-leak/);
  return result.stdout;
}

test('production terminal output has timestamps, levels, indented fields and readable errors without ANSI', () => {
  const output = renderLog(true, false);
  assert.match(output, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] INFO: Gateway is ready\r?\n/);
  assert.match(output, /\n\s+phase: "ready"/);
  assert.match(output, /\n\s+details: \{/);
  assert.match(output, /ERROR: Request failed/);
  assert.match(output, /fixture failure/);
  assert.equal(output.includes('\u001b'), false);
  assert.doesNotMatch(output, /schemaVersion|octopus-server|"level":/);
});

test('production redirected output remains parseable JSON for collectors', () => {
  const lines = renderLog(false, false)
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].msg, 'Gateway is ready');
  assert.equal(lines[0].service, 'octopus-server');
  assert.equal(lines[0].details.port, 3000);
  assert.equal(lines[1].err.message, 'fixture failure');
});

test('development retains colored pretty output', () => {
  assert.equal(renderLog(true, true).includes('\u001b['), true);
});
