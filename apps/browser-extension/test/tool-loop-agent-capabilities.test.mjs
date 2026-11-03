/**
 * @author Codex
 * @description Verifies installed SDK loop, external questions and lifecycle boundaries with deterministic models and no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolLoopAgent, tool, isStepCount, hasToolCall } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

/**
 * Returns a synthetic completion in the installed provider protocol.
 */
function response(content, finish = 'tool-calls') {
  return {
    content,
    finishReason: { unified: finish },
    warnings: [],
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
  };
}

/**
 * Produces a typed tool request from the synthetic model.
 */
function call(toolName, toolCallId, input = {}) {
  return { type: 'tool-call', toolName, toolCallId, input: JSON.stringify(input) };
}

/**
 * Creates a model that fails if the SDK requests an unexpected extra step.
 */
function modelFor(responses) {
  let index = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      assert.ok(index < responses.length, 'unexpected extra model call');
      return responses[index++];
    },
  });
}

test('native loop executes custom tools, feeds results back and naturally finishes', async () => {
  const model = modelFor([
    response([call('read_skill', 'read')]),
    response([{ type: 'text', text: 'done' }], 'stop'),
  ]);
  let reads = 0;
  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    stopWhen: isStepCount(5),
    tools: {
      read_skill: tool({
        inputSchema: z.object({}),
        execute: async () => {
          reads++;
          return { skillMarkdown: '# 技能' };
        },
      }),
    },
  });
  const result = await agent.generate({ prompt: 'run' });
  assert.equal(result.steps.length, 2);
  assert.equal(reads, 1);
  assert.equal(result.text, 'done');
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /# 技能/);
});

test('external question stops and serialized answer resumes without repeating history', async () => {
  const firstModel = modelFor([response([call('ask_user_question', 'q', { question: '编号？' })])]);
  const tools = { ask_user_question: tool({ inputSchema: z.object({ question: z.string() }) }) };
  const task = { role: 'user', content: 'run' };
  const first = await new ToolLoopAgent({ model: firstModel, tools }).generate({ messages: [task] });
  assert.equal(firstModel.doGenerateCalls.length, 1);
  const messages = JSON.parse(
    JSON.stringify([
      task,
      ...first.responseMessages,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'q',
            toolName: 'ask_user_question',
            output: { type: 'json', value: { number: '123' } },
          },
        ],
      },
    ])
  );
  const secondModel = modelFor([response([{ type: 'text', text: 'received' }], 'stop')]);
  await new ToolLoopAgent({ model: secondModel, tools }).generate({ messages });
  assert.match(JSON.stringify(secondModel.doGenerateCalls[0].prompt), /123/);
});

test('step count bounds even an endlessly requesting model', async () => {
  let count = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => response([call('observe', `r${++count}`)]),
  });
  const result = await new ToolLoopAgent({
    model,
    stopWhen: isStepCount(3),
    tools: {
      observe: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true }) }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(count, 3);
  assert.equal(result.steps.length, 3);
});

test('hasToolCall stops even when finish tool returns a failed receipt', async () => {
  const model = modelFor([response([call('finish_run', 'f')])]);
  const result = await new ToolLoopAgent({
    model,
    stopWhen: hasToolCall('finish_run'),
    tools: {
      finish_run: tool({ inputSchema: z.object({}), execute: async () => ({ ok: false }) }),
    },
  }).generate({ prompt: 'run' });
  assert.deepEqual(result.toolResults[0].output, { ok: false });
  assert.equal(model.doGenerateCalls.length, 1);
});

test('receipt-based custom stop allows correction before terminating', async () => {
  let count = 0;
  const model = modelFor([response([call('finish_run', 'f1')]), response([call('finish_run', 'f2')])]);
  const result = await new ToolLoopAgent({
    model,
    stopWhen: [isStepCount(4), ({ steps }) => steps.at(-1).toolResults.some((r) => r.output.ok === true)],
    tools: {
      finish_run: tool({ inputSchema: z.object({}), execute: async () => ({ ok: ++count === 2 }) }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(result.steps.length, 2);
});

test('pre-execution model callback sees entire batch before any execute', async () => {
  let hasQuestion = false;
  let actions = 0;
  const model = modelFor([response([call('action', 'a'), call('ask_user_question', 'q')])]);
  await new ToolLoopAgent({
    model,
    toolCallConcurrency: 1,
    onLanguageModelCallEnd: async ({ content }) => {
      hasQuestion = content.some((p) => p.type === 'tool-call' && p.toolName === 'ask_user_question');
    },
    toolApproval: ({ toolCall }) => (hasQuestion && toolCall.toolName === 'action' ? 'denied' : undefined),
    tools: {
      action: tool({
        inputSchema: z.object({}),
        execute: async () => {
          actions++;
          return {};
        },
      }),
      ask_user_question: tool({ inputSchema: z.object({}) }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(hasQuestion, true);
  assert.equal(actions, 0);
});

test('serial concurrency alone does not prevent actions beside external questions', async () => {
  let actions = 0;
  await new ToolLoopAgent({
    model: modelFor([response([call('action', 'a'), call('ask_user_question', 'q')])]),
    toolCallConcurrency: 1,
    tools: {
      action: tool({
        inputSchema: z.object({}),
        execute: async () => {
          actions++;
          return {};
        },
      }),
      ask_user_question: tool({ inputSchema: z.object({}) }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(actions, 1);
});

test('tool failure is fed to model and does not automatically terminate', async () => {
  const model = modelFor([
    response([call('action', 'a')]),
    response([{ type: 'text', text: 'failed' }], 'stop'),
  ]);
  const result = await new ToolLoopAgent({
    model,
    tools: {
      action: tool({
        inputSchema: z.object({}),
        execute: async () => {
          throw Error('TARGET_CHANGED');
        },
      }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(result.steps.length, 2);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /TARGET_CHANGED/);
});

test('SDK approval halts before executing a protected operation', async () => {
  let actions = 0;
  const result = await new ToolLoopAgent({
    model: modelFor([response([call('action', 'a')])]),
    toolApproval: { action: 'user-approval' },
    tools: {
      action: tool({
        inputSchema: z.object({}),
        execute: async () => {
          actions++;
          return {};
        },
      }),
    },
  }).generate({ prompt: 'run' });
  assert.equal(actions, 0);
  assert.match(JSON.stringify(result.responseMessages), /tool-approval-request/);
});

test('lifecycle checkpoint completes before next provider request', async () => {
  const order = [];
  const model = modelFor([response([call('read', 'r')]), response([{ type: 'text', text: 'done' }], 'stop')]);
  await new ToolLoopAgent({
    model,
    prepareStep: async ({ stepNumber }) => {
      order.push(`prepare:${stepNumber}`);
    },
    onStepEnd: async ({ stepNumber }) => {
      await Promise.resolve();
      order.push(`persist:${stepNumber}`);
    },
    tools: { read: tool({ inputSchema: z.object({}), execute: async () => ({}) }) },
  }).generate({ prompt: 'run' });
  assert.deepEqual(order, ['prepare:0', 'persist:0', 'prepare:1', 'persist:1']);
});

test('AbortSignal stops the next step after an executed tool', async () => {
  const controller = new AbortController();
  const model = modelFor([response([call('read', 'r')])]);
  await assert.rejects(
    new ToolLoopAgent({
      model,
      tools: {
        read: tool({
          inputSchema: z.object({}),
          execute: async () => {
            controller.abort();
            return {};
          },
        }),
      },
    }).generate({ prompt: 'run', abortSignal: controller.signal })
  );
  assert.equal(model.doGenerateCalls.length, 1);
});
