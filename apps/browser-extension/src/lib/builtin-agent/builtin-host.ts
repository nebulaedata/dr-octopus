/**
 * @author Codex
 * @description Runs the native ToolLoopAgent lifecycle in the window panel with authenticated durable tool RPCs.
 */
import { browser } from 'wxt/browser';
import { createBuiltinAgent } from './builtin-agent';
import type { BuiltinAgentRuntime } from './builtin-runtime';
import { createModelOptions, modelProviderFailure } from '../model-settings/model-provider';
import type { ModelSettings } from '../model-settings/model-settings-messages';

/**
 * Keeps model iteration in the SDK; Worker only commits requests, conversation parts and finite tool operations.
 */
export async function runBuiltinAgent(id: string, epoch: string, signal: AbortSignal): Promise<void> {
  let departing = false;
  const credential = { value: '' };
  const controller = new AbortController();
  /**
   * Cancels the SDK request when its registered panel document disappears.
   */
  const leave = () => {
    departing = true;
    controller.abort();
  };
  signal.addEventListener('abort', leave, { once: true });
  if (signal.aborted) {
    signal.removeEventListener('abort', leave);
    return;
  }
  /**
   * Rejects stale identities and transport failures before the SDK can continue.
   */
  async function request(type: string, fields: Record<string, unknown> = {}) {
    const reply = await browser.runtime.sendMessage({ type, id, epoch, ...fields });
    if (!reply?.ok) {
      throw Error(reply?.error ?? 'SKILL_SESSION_STALE');
    }
    return reply.value;
  }
  let stopped = false;
  const runtime: BuiltinAgentRuntime = {
    prepare: () => request('skill.host.prepare'),
    record: async (messages, calls, finishReason) => {
      const state = await request('skill.host.step', { messages, calls, finishReason });
      stopped = state.status !== 'running';
    },
    checkpoint: async (messages) => {
      const state = await request('skill.host.checkpoint', { messages });
      stopped ||= state.stopped;
    },
    execute: async (toolCallId) => {
      const result = await request('skill.host.tool', { toolCallId });
      stopped ||= result.status !== 'running';
      return result.output;
    },
    stopped: () => stopped,
  };
  try {
    const payload = (await request('skill.host.ready')) as {
      mode: 'organize' | 'replay';
      settings: ModelSettings;
      apiKey: string;
      stepTimeoutMs?: number;
    };
    credential.value = payload.apiKey;
    payload.apiKey = '';
    const options = createModelOptions(payload.settings, credential.value, controller.signal);
    const agent = createBuiltinAgent(
      options.model,
      payload.mode,
      options.providerOptions,
      runtime,
      payload.stepTimeoutMs
    );
    await agent.generate({ prompt: '继续当前任务。', abortSignal: controller.signal });
    await request('skill.host.end');
  } catch (error) {
    if (!departing) {
      const code =
        error instanceof Error && /^(SKILL|MODEL)_[A-Z_]+$/.test(error.message)
          ? error.message
          : controller.signal.aborted
            ? 'MODEL_TIMEOUT'
            : modelProviderFailure(error);
      await request('skill.host.failed', { error: code }).catch(() => {});
    }
  } finally {
    credential.value = '';
    signal.removeEventListener('abort', leave);
  }
}
