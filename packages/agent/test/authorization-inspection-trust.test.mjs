/**
 * @author Codex
 * @description Verifies that inspection resolves global trust handlers before importing any project extension.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CONFIG_DIR_NAME, ProjectTrustStore } from '@earendil-works/pi-coding-agent';
import { collectInspectionTools } from '../dist/extensions/scheduler/infrastructure/tool-inspection.js';
import { inspectionConfigurationRevision } from '../dist/extensions/scheduler/infrastructure/inspection-configuration.js';

/**
 * Use separate global and project extensions; the project writes its marker at import time.
 */
async function fixture(t, { decisions, defaultTrust, stored }) {
  const root = await mkdtemp(join(tmpdir(), 'inspection-trust-'));
  const agentDir = join(root, 'agent');
  const cwd = join(root, 'workspace');
  const projectDirectory = join(cwd, CONFIG_DIR_NAME, 'extensions');
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, 'project-imported');
  const trace = join(root, 'trust-trace');
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProjectTrust: defaultTrust }));
  await writeFile(
    join(agentDir, 'extensions', 'guard.js'),
    `
    import {appendFileSync} from 'node:fs';
    export default function guard(pi) {
      appendFileSync(${JSON.stringify(trace)}, 'factory\\n');
      for (const decision of ${JSON.stringify(decisions)}) {
        pi.on('project_trust', async (event, ctx) => {
          if (event.cwd !== ${JSON.stringify(cwd)} || ctx.hasUI || ctx.mode !== 'rpc' || await ctx.ui.confirm('Trust?')) throw new Error('Unexpected trust context');
          appendFileSync(${JSON.stringify(trace)}, decision + '\\n');
          if (decision === 'throw') throw new Error('Trust provider failed');
          return {trusted: decision, remember: true};
        });
      }
    }
  `
  );
  const project = join(projectDirectory, 'project.js');
  await writeFile(
    project,
    `
    import {writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(marker)}, 'imported');
    export default function project(pi) {
      pi.registerTool({name:'project_ping',label:'Ping',description:'Project ping',parameters:{type:'object',properties:{}},async execute(){throw new Error('Inspection must not execute tools');}});
    }
  `
  );
  const store = new ProjectTrustStore(agentDir);
  if (stored !== undefined) store.set(cwd, stored);
  return { agentDir, cwd, marker, trace, project, store };
}

test('inspection honors ordered global trust decisions before loading project resources', async (t) => {
  const cases = [
    { name: 'first decisive allow wins', decisions: ['yes', 'no'], defaultTrust: 'never', allowed: true },
    { name: 'explicit deny overrides always', decisions: ['no'], defaultTrust: 'always', allowed: false },
    {
      name: 'explicit deny overrides saved trust',
      decisions: ['no'],
      defaultTrust: 'always',
      stored: true,
      allowed: false,
    },
    {
      name: 'explicit allow overrides never without persisting remember',
      decisions: ['yes'],
      defaultTrust: 'never',
      allowed: true,
    },
    {
      name: 'undecided continues to first decisive handler',
      decisions: ['undecided', 'no', 'yes'],
      defaultTrust: 'always',
      allowed: false,
    },
    {
      name: 'undecided uses saved denial',
      decisions: ['undecided'],
      defaultTrust: 'always',
      stored: false,
      allowed: false,
    },
    {
      name: 'undecided uses always default',
      decisions: ['undecided'],
      defaultTrust: 'always',
      allowed: true,
    },
    {
      name: 'unanswered ask remains untrusted',
      decisions: ['undecided'],
      defaultTrust: 'ask',
      allowed: false,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (t) => {
      const f = await fixture(t, scenario);
      const tools = await collectInspectionTools(f.cwd, 'test-session', [], f.agentDir);
      assert.equal(
        tools.some((tool) => tool.name === 'project_ping'),
        scenario.allowed
      );
      assert.equal(
        await readFile(f.marker, 'utf8').then(
          () => true,
          () => false
        ),
        scenario.allowed
      );
      assert.equal(f.store.get(f.cwd), scenario.stored ?? null);
      const lines = (await readFile(f.trace, 'utf8')).trim().split('\n');
      assert.equal(lines.filter((line) => line === 'factory').length, 1);
      const decisive = scenario.decisions.findIndex((decision) => decision !== 'undecided');
      assert.deepEqual(
        lines.slice(1),
        decisive < 0 ? scenario.decisions : scenario.decisions.slice(0, decisive + 1)
      );
    });
  }
});

test('trust handler errors and invalid decisions fail inspection before importing project code', async (t) => {
  for (const decision of ['throw', 'invalid']) {
    await t.test(decision, async (t) => {
      const f = await fixture(t, { decisions: [decision], defaultTrust: 'always' });
      await assert.rejects(
        collectInspectionTools(f.cwd, 'test-session', [], f.agentDir),
        /Trust provider failed|Invalid project_trust/
      );
      await assert.rejects(readFile(f.marker), { code: 'ENOENT' });
    });
  }
});

test('approval fingerprint observes project entries even when only a handler can grant trust, without executing it', async (t) => {
  const f = await fixture(t, { decisions: ['yes'], defaultTrust: 'never' });
  const first = await inspectionConfigurationRevision(f.agentDir, f.cwd);
  await writeFile(
    f.project,
    'throw new Error("Changed project extension must not execute during fingerprinting");'
  );
  assert.notEqual(await inspectionConfigurationRevision(f.agentDir, f.cwd), first);
  await assert.rejects(readFile(f.trace), { code: 'ENOENT' });
  await assert.rejects(readFile(f.marker), { code: 'ENOENT' });
});

test('trusted project settings errors cannot silently fall back to global settings', async (t) => {
  const f = await fixture(t, { decisions: ['yes'], defaultTrust: 'never' });
  await writeFile(join(f.cwd, CONFIG_DIR_NAME, 'settings.json'), '{invalid');
  await assert.rejects(
    collectInspectionTools(f.cwd, 'test-session', [], f.agentDir),
    /trusted workspace settings/
  );
});
