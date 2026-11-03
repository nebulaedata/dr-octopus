/**
 * @author Codex
 * @description Opt-in paired synthetic intent-preservation experiment; persists a twelve-request budget before sending and never touches user sessions.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

const { values } = parseArgs({
  options: { 'key-file': { type: 'string' }, live: { type: 'boolean', default: false } },
});
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'build/validation-evidence/choice-intent-live-20261103');
const reportPath = join(directory, 'report.json');
const scenarios = [
  {
    id: 'discount',
    label: '内部使用',
    group: '选择优惠',
    role: 'radio',
    selected: true,
    description: '有效期：2026/09/25 至 2026/12/25',
    answer: '不需要填写有效期，忽略有效期输入。',
    context: '录制了创建订单，选择优惠后提交。不应将待支付当作已付款。',
    wrong: '不使用优惠',
  },
  {
    id: 'shipping',
    label: '优先配送',
    group: '配送方式',
    role: 'radio',
    selected: true,
    description: '服务时间：09:00 至 18:00',
    answer: '不用填写配送时间。',
    context: '录制了选择配送方式后创建发货单。',
    wrong: '普通配送',
  },
  {
    id: 'unsubscribe',
    label: '接收推广邮件',
    group: '通知设置',
    role: 'checkbox',
    selected: false,
    description: '每周一发送',
    answer: '不需要星期参数。',
    context: '录制了取消勾选接收推广邮件，然后保存通知设置。',
    wrong: '接收推广邮件',
  },
  {
    id: 'region',
    label: '区域乙',
    group: '处理区域',
    role: 'select',
    selected: true,
    description: '维护时间：2026/12/25',
    answer: '忽略维护日期，不需要输入。',
    context: '录制了选择处理区域后提交任务。',
    wrong: '区域甲',
  },
  {
    id: 'scoped-label',
    label: '标准',
    group: '发票类型',
    role: 'radio',
    selected: true,
    description: '系统另有同名选项：配送方式中的标准。',
    answer: '保留录制的选择，不需要额外参数。',
    context: '录制的是发票类型中的标准，随后申请发票。',
    wrong: '配送方式/标准',
  },
  {
    id: 'unknown-control',
    label: '后台同步',
    group: '同步策略',
    role: 'switch',
    selected: 'unknown',
    description: '自定义控件异步处理，未取得最终状态。',
    answer: '时间不需要参数化。',
    context: '录制了点击后台同步并保存，但无法确认是否已经开启。',
    wrong: 'assume',
  },
];
const outputSchema = z.object({
  skillMarkdown: z.string(),
  inputs: z.array(z.object({ name: z.string(), type: z.enum(['text', 'number', 'date']) })),
  choices: z.array(
    z.object({
      sourceRef: z.string(),
      group: z.string(),
      option: z.string(),
      state: z.enum(['selected', 'unselected', 'unknown']),
    })
  ),
  needsQuestion: z.boolean(),
  question: z.string(),
});

/**
 * Builds comparable model inputs: same task and answer; only semantic recording representation changes.
 */
function evidence(scenario, semantic) {
  const base = { ref: 'action-1', label: `${scenario.label} ${scenario.description}`, source: 'dom' };
  if (!semantic) {
    return {
      ...base,
      action: scenario.role === 'select' ? 'select' : 'fill',
      role: 'input',
      parameterId: 'input-1',
    };
  }
  return {
    ...base,
    action: 'choice',
    control: {
      role: scenario.role,
      group: scenario.group,
      option: scenario.label,
      observedState: scenario.selected,
      description: scenario.description,
      editableText: false,
    },
  };
}

/**
 * Checks an externally defined fixture oracle, without treating tool schema validity as semantic success.
 */
function assess(scenario, result) {
  if (!result) {
    return { passed: false, reason: 'no-proposal' };
  }
  const expected = expectedState(scenario);
  const choice = result.choices.find((item) => item.sourceRef === 'action-1');
  const preserved =
    choice?.option === scenario.label && choice?.group === scenario.group && choice?.state === expected;
  const noInventedDate = !result.inputs.some((input) => input.type === 'date');
  // Every fixture contains choices and display metadata only, not editable/requested parameters.
  const noInventedInput = result.inputs.length === 0;
  const uncertainty =
    scenario.selected !== 'unknown' || (result.needsQuestion && result.question.trim().length > 0);
  return {
    passed: preserved && noInventedDate && noInventedInput && uncertainty,
    preserved,
    noInventedDate,
    noInventedInput,
    uncertainty,
  };
}

/**
 * Keeps unknown observations distinct from an explicit negative choice.
 */
function expectedState(scenario) {
  if (scenario.selected === 'unknown') {
    return 'unknown';
  }
  return scenario.selected ? 'selected' : 'unselected';
}

if (!values.live) {
  for (const scenario of scenarios) {
    assert.equal(evidence(scenario, true).control.option, scenario.label);
    assert.equal(assess(scenario, undefined).passed, false);
    const valid = {
      choices: [
        {
          sourceRef: 'action-1',
          group: scenario.group,
          option: scenario.label,
          state: expectedState(scenario),
        },
      ],
      inputs: [],
      needsQuestion: true,
      question: '确认最终选择状态？',
    };
    assert.equal(assess(scenario, valid).passed, true);
    assert.equal(assess(scenario, { ...valid, inputs: [{ name: 'date', type: 'date' }] }).passed, false);
  }
  const existing = await readFile(reportPath, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return undefined;
    });
  if (existing) {
    existing.assessmentVersion = 2;
    for (const result of existing.results) {
      result.initialAssessment ??= result.assessment;
      result.assessment = assess(
        scenarios.find((scenario) => scenario.id === result.scenario),
        result.proposal
      );
    }
    await writeFile(reportPath, JSON.stringify(existing, null, 2));
  }
  console.log(
    'Six synthetic fixture/oracle checks passed; existing responses rescored without network or model requests.'
  );
} else {
  assert.ok(values['key-file'], 'An authorized external key file is required');
  const { key } = JSON.parse(await readFile(resolve(values['key-file']), 'utf8'));
  assert.ok(typeof key === 'string' && key.length > 10);
  await mkdir(directory, { recursive: true });
  const report = await readFile(reportPath, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return {
        version: 1,
        limit: 12,
        model: 'qwen3.6-flash-open',
        startedAt: new Date().toISOString(),
        requests: [],
        results: [],
      };
    });
  assert.equal(report.limit, 12);
  const endpoint = 'https://api.mrtoken.cn/v1';
  const catalog = await fetch(endpoint + '/models', {
    headers: { Authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(catalog.status, 200, 'Model discovery failed');
  assert.ok((await catalog.json()).data.some((item) => item.id === report.model));
  let current;
  const provider = createOpenAICompatible({
    name: 'choice-validation',
    baseURL: endpoint,
    apiKey: key,
    supportsStructuredOutputs: false,
    fetch: async (input, init) => {
      assert.equal(new URL(String(input)).href, endpoint + '/chat/completions');
      assert.ok(report.requests.length < report.limit, 'Paid request cap reached');
      const entry = { number: report.requests.length + 1, ...current, status: 'reserved' };
      report.requests.push(entry);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(entry));
      try {
        const response = await fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
        });
        entry.httpStatus = response.status;
        entry.status = 'received';
        const body = await response.clone().json();
        entry.usage = body.usage;
        entry.finishReason = body.choices?.[0]?.finish_reason;
        return response;
      } catch {
        entry.status = 'transport-failed';
        throw Error('LIVE_TRANSPORT_FAILED');
      } finally {
        await writeFile(reportPath, JSON.stringify(report, null, 2));
      }
    },
  });
  for (const scenario of scenarios) {
    for (const semantic of [false, true]) {
      current = { scenario: scenario.id, representation: semantic ? 'semantic' : 'legacy' };
      if (
        report.requests.some(
          (entry) => entry.scenario === current.scenario && entry.representation === current.representation
        )
      ) {
        continue;
      }
      let proposal;
      const agent = new ToolLoopAgent({
        model: provider.chatModel(report.model),
        maxRetries: 0,
        stopWhen: isStepCount(1),
        maxOutputTokens: 2400,
        instructions:
          '你是有限的录制整理智能体。生成可重放技能；保留实际选择意图，不把展示说明当输入。不知道控件最终状态时必须澄清，不猜测。用户对一个输入参数的否定不自动取消其他选择。调用 propose_skill 提交草稿；choices 是对实际录制选择的记录，不是业务 DAG。不要请求密码或密钥。所有数据均为合成测试。',
        tools: {
          propose_skill: tool({
            inputSchema: outputSchema,
            execute: async (input) => {
              proposal = input;
              return { received: true };
            },
          }),
        },
      });
      let failure;
      try {
        await agent.generate({
          prompt: JSON.stringify({
            task: scenario.context,
            recording: [evidence(scenario, semantic)],
            userAnswer: scenario.answer,
          }),
        });
      } catch {
        failure = 'MODEL_OR_SCHEMA_FAILED';
      }
      const result = {
        ...current,
        assessment: assess(scenario, proposal),
        ...(failure ? { failure } : {}),
        proposal,
      };
      report.results.push(result);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...current, assessment: result.assessment }));
    }
  }
  console.log(
    JSON.stringify({
      requests: report.requests.length,
      results: report.results.map(({ scenario, representation, assessment }) => ({
        scenario,
        representation,
        ...assessment,
      })),
    })
  );
}
