/**
 * @author Codex
 * @description Verify installed Pi acknowledges extension handlers only after completion, regardless of output.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

test('Pi preflight acknowledgement waits for silent, notify and custom-message command handlers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-command-completion-'));
  let session;
  t.after(async () => {
    session?.dispose();
    await rm(root, { recursive: true, force: true });
  });
  let gate;
  let entered;
  const outputs = [];
  const settingsManager = SettingsManager.inMemory({ autoRetryEnabled: false });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      {
        name: 'test-command-completion',
        factory: (pi) => {
          for (const name of ['silent', 'notify', 'custom']) {
            pi.registerCommand(name, {
              handler: async (_args, ctx) => {
                if (name === 'notify') ctx.ui.notify('Progress', 'info');
                if (name === 'custom')
                  pi.sendMessage(
                    { customType: 'any-custom-type', content: 'Progress', display: true },
                    { triggerTurn: false }
                  );
                entered.resolve();
                await gate.promise;
              },
            });
          }
        },
      },
    ],
  });
  await resourceLoader.reload();
  const result = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(root),
    tools: [],
  });
  session = result.session;
  assert.deepEqual(result.extensionsResult.errors, []);
  await session.bindExtensions({ mode: 'rpc', uiContext: { notify: (message) => outputs.push(message) } });
  for (const name of ['silent', 'notify', 'custom']) {
    gate = Promise.withResolvers();
    entered = Promise.withResolvers();
    const acknowledgements = [];
    const prompt = session.prompt('/' + name, { preflightResult: (ok) => acknowledgements.push(ok) });
    await entered.promise;
    assert.deepEqual(acknowledgements, [], 'progress output cannot acknowledge an unfinished handler');
    gate.resolve();
    await prompt;
    assert.deepEqual(acknowledgements, [true]);
    assert.equal(session.isStreaming, false);
    assert.equal(session.isCompacting, false);
    assert.equal(session.pendingMessageCount, 0);
  }
  assert.deepEqual(outputs, ['Progress']);
  assert.equal(session.messages.filter((message) => message.customType === 'any-custom-type').length, 1);
});
