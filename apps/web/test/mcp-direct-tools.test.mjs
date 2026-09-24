/**
 * @author Codex
 * @description Guards search-mode and allowlist preservation when editing MCP settings after an adapter upgrade.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServerConfigurationInputSchema } from '@octopus/shared/protocol';
import { isDirectToolsEnabled, resolveDirectTools } from '../src/features/settings/utils/mcp-direct-tools.ts';

test('search and allowlist strategies survive the form switch and API validation', () => {
  for (const previous of ['search', ['read_*'], true, false, undefined]) {
    const result = resolveDirectTools(isDirectToolsEnabled(previous), previous);
    const parsed = McpServerConfigurationInputSchema.parse({
      connection: { type: 'stdio', command: 'test-server', args: [] },
      directTools: result,
    });
    assert.deepEqual(parsed.directTools, previous ?? false);
    assert.equal(resolveDirectTools(false, previous), false);
  }
  assert.equal(resolveDirectTools(true, undefined), true);
});
