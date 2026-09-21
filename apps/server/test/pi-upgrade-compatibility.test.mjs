/**
 * @author Codex
 * @description Guards branded Pi paths and loading the installed MCP extension through Pi's public resource API.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CONFIG_DIR_NAME,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

test('installed Pi preserves branded defaults and the existing Agent directory override', () => {
  const previous = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  try {
    delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    assert.equal(CONFIG_DIR_NAME, '.dr-octopus');
    assert.equal(getAgentDir(), join(homedir(), '.dr-octopus', 'agent'));
    process.env.DR_OCTOPUS_CODING_AGENT_DIR = join(tmpdir(), 'octopus-brand-probe');
    assert.equal(getAgentDir(), process.env.DR_OCTOPUS_CODING_AGENT_DIR);
  } finally {
    if (previous === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previous;
  }
});

test('installed MCP package registers its tools and commands with the upgraded Pi loader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'octopus-mcp-compatibility-'));
  const previous = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
  try {
    process.env.DR_OCTOPUS_CODING_AGENT_DIR = root;
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [fileURLToPath(import.meta.resolve('pi-mcp-adapter'))],
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const extension = result.extensions.find((candidate) => candidate.tools.has('mcp'));
    assert.ok(extension, 'MCP proxy tool must remain registered');
    assert.ok(extension.commands.has('mcp'), 'MCP command must remain registered');
  } finally {
    if (previous === undefined) delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    else process.env.DR_OCTOPUS_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
