/**
 * @author Codex
 * @description Verifies runtime artifact exports use readable Host-owned paths and clean temporary files.
 */

import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import test from 'node:test';
import { RuntimeArtifacts } from '../dist/lib/runtime/artifacts.js';

test('exports standalone HTML through an absolute temporary path and removes it after reading', async () => {
  let generatedPath;
  const artifacts = new RuntimeArtifacts({
    piSessions: {},
    async execute(sessionId, command) {
      assert.equal(sessionId, 'session-1');
      assert.equal(command.type, 'export_html');
      assert.equal(isAbsolute(command.outputPath), true);
      generatedPath = command.outputPath;
      await writeFile(command.outputPath, '<!doctype html><title>Export works</title>', 'utf8');
      return {
        type: 'response',
        command: 'export_html',
        success: true,
        data: { path: command.outputPath },
      };
    },
  });

  assert.equal(await artifacts.exportHtml('session-1'), '<!doctype html><title>Export works</title>');
  await assert.rejects(access(generatedPath), { code: 'ENOENT' });
});
