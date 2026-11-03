/**
 * @author Codex
 * @description Probes real SDK replay/question boundaries with deterministic models; no production runner or browser actions are implemented here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
};
const questionSchema = z.object({
  question: z.string(),
  type: z.enum(['text', 'email', 'single', 'multiple']),
});
const targetSchema = z.object({ snapshotId: z.string(), elementIndex: z.number().int(), text: z.string() });

test('permission recovery prototype limits SDK tools and independently rejects a hallucinated navigation before effects', async () => {
  let effects = 0;
  let rejected = 0;
  let requested;
  const permitted = ['ask_user_question', 'finish_run'];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      requested = options.tools.map((entry) => entry.name);
      return response([call('browser_navigate', 'unexpected', { url: 'https://fixture.test/' })]);
    },
  });
  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    stopWhen: isStepCount(1),
    prepareStep: () => ({ activeTools: permitted }),
    tools: {
      browser_navigate: tool({
        inputSchema: z.object({ url: z.string() }),
        execute: async () => {
          // A Host-side gate remains necessary even when the SDK omits a tool from model-visible definitions.
          if (!permitted.includes('browser_navigate')) {
            rejected++;
            throw Error('PAGE_PERMISSION_REQUIRED');
          }
          effects++;
          return { applied: true };
        },
      }),
      ask_user_question: tool({ inputSchema: questionSchema }),
      finish_run: tool({
        inputSchema: z.object({ outcome: z.literal('incomplete') }),
        execute: async () => ({ finished: true }),
      }),
    },
  });
  const output = await agent.generate({ prompt: '权限已撤销，请处理。' });
  assert.deepEqual(requested.sort(), permitted.toSorted());
  assert.equal(effects, 0);
  assert.ok(
    rejected > 0 || output.content.some((entry) => entry.type === 'tool-error'),
    'Either SDK or Host must reject hidden tools'
  );
});

test('permission recovery prototype yields a question instead of polling denied pages or guessing permission', async () => {
  let effects = 0;
  const model = new MockLanguageModelV4({
    doGenerate: response([
      call('ask_user_question', 'permission', {
        question: '请在浏览器设置中恢复站点访问权限，或结束本次任务。',
        type: 'single',
      }),
    ]),
  });
  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    stopWhen: isStepCount(2),
    prepareStep: () => ({ activeTools: ['ask_user_question', 'finish_run'] }),
    tools: {
      ask_user_question: tool({ inputSchema: questionSchema }),
      finish_run: tool({
        inputSchema: z.object({ outcome: z.literal('incomplete') }),
        execute: async () => ({ finished: true }),
      }),
      browser_navigate: tool({
        inputSchema: z.object({ url: z.string() }),
        execute: async () => {
          effects++;
        },
      }),
    },
  });
  const result = await agent.generate({ prompt: '站点权限缺失，不能执行页面操作。' });
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(result.toolCalls[0].toolName, 'ask_user_question');
  assert.equal(effects, 0);
});

/**
 * Builds a provider tool call consumed by the actual SDK.
 */
function call(toolName, toolCallId, input) {
  return { type: 'tool-call', toolName, toolCallId, input: JSON.stringify(input) };
}

/**
 * Supplies one deterministic provider completion without network requests.
 */
function response(content) {
  return { content, usage, warnings: [], finishReason: { unified: 'tool-calls' } };
}

/**
 * Creates a test-only replay profile with external side effects and questions.
 */
function replay(model, snapshot) {
  return new ToolLoopAgent({
    model,
    maxRetries: 0,
    toolCallConcurrency: 1,
    stopWhen: isStepCount(4),
    tools: {
      browser_snapshot: tool({ inputSchema: z.object({}), execute: snapshot }),
      browser_fill: tool({ inputSchema: targetSchema }),
      ask_user_question: tool({ inputSchema: questionSchema }),
    },
  });
}

test('serial SDK execution does not prevent an automatic action beside an unanswered question', async () => {
  let actions = 0;
  const model = new MockLanguageModelV4({
    doGenerate: response([
      call('ask_user_question', 'q1', { question: '请输入编号', type: 'text' }),
      call('browser_fill', 'a1', { snapshotId: 'old', elementIndex: 1, text: 'guessed' }),
    ]),
  });
  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    toolCallConcurrency: 1,
    stopWhen: isStepCount(1),
    tools: {
      ask_user_question: tool({ inputSchema: questionSchema }),
      browser_fill: tool({
        inputSchema: targetSchema,
        execute: async () => {
          actions++;
          return { applied: true };
        },
      }),
    },
  });
  await agent.generate({ prompt: '运行查询技能' });
  assert.equal(actions, 1, 'Concurrency one is not a human-answer barrier');
});

test('external action tools return complete intents without acting or starting another model request', async () => {
  let observations = 0;
  const model = new MockLanguageModelV4({
    doGenerate: response([
      call('browser_fill', 'a1', { snapshotId: 'old', elementIndex: 1, text: 'guessed' }),
      call('ask_user_question', 'q1', { question: '请输入邮箱', type: 'email' }),
      call('ask_user_question', 'q2', { question: '请选择范围', type: 'multiple' }),
    ]),
  });
  const agent = replay(model, async () => {
    observations++;
    return {};
  });
  const result = await agent.generate({ prompt: '运行查询技能' });
  assert.equal(agent.tools.browser_fill.execute, undefined);
  assert.equal(agent.tools.ask_user_question.execute, undefined);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(observations, 0);
  assert.deepEqual(
    result.toolCalls.map((item) => item.toolCallId),
    ['a1', 'q1', 'q2']
  );
});

test('serialized paired rejection and answer results continue a new Agent with a fresh observation', async () => {
  const task = { role: 'user', content: '运行订单查询技能' };
  const firstModel = new MockLanguageModelV4({
    doGenerate: response([
      call('browser_fill', 'a1', { snapshotId: 'old', elementIndex: 1, text: 'guessed' }),
      call('ask_user_question', 'q1', { question: '请输入订单编号', type: 'text' }),
      call('ask_user_question', 'q2', { question: '选择订单类型', type: 'single' }),
    ]),
  });
  const first = await replay(firstModel, async () => ({})).generate({ messages: [task] });
  const messages = JSON.parse(
    JSON.stringify([
      task,
      ...first.responseMessages,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'browser_fill',
            toolCallId: 'a1',
            output: { type: 'error-text', value: 'USER_ANSWER_REQUIRED' },
          },
          {
            type: 'tool-result',
            toolName: 'ask_user_question',
            toolCallId: 'q2',
            output: { type: 'error-text', value: 'QUESTION_ALREADY_PENDING' },
          },
          {
            type: 'tool-result',
            toolName: 'ask_user_question',
            toolCallId: 'q1',
            output: { type: 'json', value: { status: 'answered', value: 'ORDER-007' } },
          },
        ],
      },
    ])
  );
  let observed = 0;
  const nextModel = new MockLanguageModelV4({
    doGenerate: [
      response([call('browser_snapshot', 'o2', {})]),
      response([call('browser_fill', 'a2', { snapshotId: 'fresh', elementIndex: 3, text: 'ORDER-007' })]),
    ],
  });
  const result = await replay(nextModel, async () => {
    observed++;
    return { snapshotId: 'fresh', elements: [{ index: 3, label: '订单编号' }] };
  }).generate({ messages });
  assert.equal(observed, 1);
  assert.equal(nextModel.doGenerateCalls.length, 2);
  const pendingAction = result.toolCalls.find((item) => item.toolCallId === 'a2');
  assert.equal(pendingAction.input.snapshotId, 'fresh');
  const prompt = JSON.stringify(nextModel.doGenerateCalls[0].prompt);
  assert.ok(prompt.includes('USER_ANSWER_REQUIRED'));
  assert.ok(prompt.includes('ORDER-007'));
  assert.ok(result.toolCalls.some((item) => item.toolCallId === 'o2'));
  // This proves SDK message compatibility, not a production fresh-observation gate.
});

test('unknown action outcomes remain explicit tool results and restoring history executes nothing automatically', async () => {
  const messages = [
    { role: 'user', content: '发送本次已授权邮件' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolName: 'browser_fill',
          toolCallId: 'a1',
          input: { snapshotId: 's1', elementIndex: 1, text: 'demo@example.com' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'browser_fill',
          toolCallId: 'a1',
          output: { type: 'json', value: { businessEffect: 'unknown', code: 'OUTCOME_UNKNOWN' } },
        },
      ],
    },
  ];
  const model = new MockLanguageModelV4({
    doGenerate: response([
      call('ask_user_question', 'q1', {
        question: '页面结果无法确认，请检查后选择是否结束本次任务。',
        type: 'single',
      }),
    ]),
  });
  let observations = 0;
  const agent = replay(model, async () => {
    observations++;
    return {};
  });
  const result = await agent.generate({ messages });
  assert.equal(observations, 0);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.ok(JSON.stringify(model.doGenerateCalls[0].prompt).includes('OUTCOME_UNKNOWN'));
  assert.equal(result.toolCalls[0].toolName, 'ask_user_question');
  assert.equal(agent.tools.browser_fill.execute, undefined);
  // Model behavior is scripted: production replay suppression still needs a durable execution ledger.
});
