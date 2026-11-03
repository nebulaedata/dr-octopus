/**
 * @author Codex
 * @description Tests a bounded choice phase on isolated real pages; semantic DOM bindings are a fixture adapter, not a claimed public PageController feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { ToolLoopAgent, isStepCount } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { choiceToolPrototype } from '../fixtures/choice-tool-prototype.mjs';
/* global ControllerProbe */
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'build/validation-evidence/apply-choice-poc-20261103');
const keyFile = process.env.APPLY_CHOICE_LIVE_KEY;
const bundle = await build({
  stdin: { contents: "export {PageController} from '@page-agent/page-controller';", resolveDir: root },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  globalName: 'ControllerProbe',
});
const requirement = { id: 'choice-1', group: '配送方式', option: '优先配送', role: 'radio', checked: true };

/**
 * Supplies fixed synthetic markup only, and dispatches through the unmodified public PageController.
 */
async function fixture(browser, scenario) {
  const page = await browser.newPage();
  let control =
    '<label><input id="wanted" type="radio" name="delivery" aria-label="优先配送">优先配送</label>';
  if (scenario === 'missing') {
    control = '';
  }
  if (scenario === 'duplicate') {
    control += control.replace('wanted', 'duplicate');
  }
  if (scenario === 'disabled') {
    control = control.replace('type=', 'disabled type=');
  }
  if (scenario === 'unchecked') {
    control = '<label><input id="wanted" type="checkbox" checked aria-label="优先配送">优先配送</label>';
  }
  await page.route('https://choice.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><style>body{padding:30px}label{display:block;margin:12px}</style>
    <fieldset><legend>配送方式</legend><label><input id="ordinary" type="radio" name="delivery" checked aria-label="普通配送">普通配送</label>${control}</fieldset>
    <fieldset><legend>发票类型</legend><label><input id="other" type="radio" name="invoice" aria-label="优先配送">优先配送</label></fieldset>
    <script>window.clicks=[];document.addEventListener('click',e=>{if(e.target.id)window.clicks.push(e.target.id)})</script>`,
    })
  );
  await page.goto('https://choice.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    window.controller = new ControllerProbe.PageController({ enableMask: false });
    window.generation = 0;
  });
  const adapter = {
    observe: async () =>
      page.evaluate(async () => {
        const state = await window.controller.getBrowserState();
        window.generation++;
        // This trusted fixture oracle is intentionally separate from the PageController text API.
        return [...document.querySelectorAll('fieldset input')].map((input) => {
          const row = state.content
            .split('\n')
            .filter((line) => line.includes('id=' + input.id + ' ') || line.includes('id=' + input.id + '/'));
          const match = row.length === 1 ? /\[(\d+)\]<input\b/.exec(row[0]) : null;
          return {
            id: input.id,
            role: input.type,
            group: input.closest('fieldset').querySelector('legend').textContent,
            option: input.getAttribute('aria-label'),
            checked: input.checked,
            enabled: !input.disabled,
            index: match ? Number(match[1]) : null,
            generation: window.generation,
          };
        });
      }),
    apply: async (observed) => {
      if (scenario === 'changed') {
        await page.evaluate(() => {
          document.querySelector('#wanted').setAttribute('aria-label', '其他配送');
        });
      }
      if (scenario === 'moved-group') {
        await page.evaluate(() =>
          document.querySelectorAll('fieldset')[1].append(document.querySelector('#wanted').closest('label'))
        );
      }
      if (scenario === 'cancelled-click') {
        await page.evaluate(() =>
          document
            .querySelector('#wanted')
            .addEventListener('click', (event) => event.preventDefault(), { once: true })
        );
      }
      return page.evaluate(async (original) => {
        const control = document.getElementById(original.id);
        if (
          !control ||
          original.generation !== window.generation ||
          control.disabled ||
          control.getAttribute('aria-label') !== original.option ||
          control.type !== original.role ||
          control.closest('fieldset')?.querySelector('legend')?.textContent !== original.group ||
          control.checked !== original.checked
        ) {
          return 'changed';
        }
        if (original.index === null) {
          return 'unknown';
        }
        const result = await window.controller.clickElement(original.index);
        return result.success ? 'applied' : 'unknown';
      }, observed);
    },
  };
  return {
    page,
    adapter,
    close: async () => {
      await page.evaluate(() => window.controller.dispose());
      await page.close();
    },
  };
}

for (const flavor of ['chrome', 'edge']) {
  test(
    `${flavor}: bounded apply_choice preserves identity, state and refusal across raw tools`,
    { timeout: 60000 },
    async () => {
      const browser = await chromium.launch({
        executablePath:
          flavor === 'chrome'
            ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
            : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
        headless: true,
      });
      const results = [];
      try {
        for (const scenario of [
          'available',
          'missing',
          'duplicate',
          'disabled',
          'unchecked',
          'changed',
          'moved-group',
          'cancelled-click',
        ]) {
          const f = await fixture(browser, scenario);
          try {
            const wanted = { ...requirement };
            if (scenario === 'unchecked') {
              wanted.role = 'checkbox';
              wanted.checked = false;
            }
            const prototype = choiceToolPrototype([wanted], f.adapter);
            const apply = (input) => prototype.tools.apply_choice.execute(input);
            assert.equal((await apply({ requirementId: 'other' })).status, 'invalid_requirement');
            const first = await apply({ requirementId: wanted.id });
            const expected = {
              available: 'satisfied',
              missing: 'unavailable',
              duplicate: 'ambiguous',
              disabled: 'unknown',
              unchecked: 'satisfied',
              changed: 'page_changed',
              'moved-group': 'page_changed',
              'cancelled-click': 'outcome_unknown',
            }[scenario];
            assert.equal(first.status, expected);
            if (first.status === 'satisfied') {
              assert.deepEqual(await apply({ requirementId: wanted.id }), {
                status: 'satisfied',
                changed: false,
              });
            }
            assert.equal(
              (await prototype.tools.browser_click.execute({ elementIndex: 0 })).status,
              'raw_mutation_forbidden'
            );
            assert.equal(
              (await prototype.tools.browser_fill.execute({ text: 'override' })).status,
              'raw_mutation_forbidden'
            );
            const clicks = await f.page.evaluate(() => window.clicks);
            assert.deepEqual(
              clicks,
              first.status === 'satisfied' || scenario === 'cancelled-click' ? ['wanted'] : []
            );
            assert.equal(await f.page.locator('#other').isChecked(), false);
            const finish = await prototype.tools.finish_run.execute({});
            assert.equal(finish.finished, first.status === 'satisfied');
            results.push({ scenario, first, finish, clicks });
          } finally {
            await f.close();
          }
        }
        const f = await fixture(browser, 'available');
        try {
          const adapter = {
            ...f.adapter,
            apply: async (target) => {
              await f.adapter.apply(target);
              throw Error('lost-result');
            },
          };
          const prototype = choiceToolPrototype([requirement], adapter);
          assert.equal(
            (await prototype.tools.apply_choice.execute({ requirementId: requirement.id })).status,
            'outcome_unknown'
          );
          assert.equal(
            (await prototype.tools.apply_choice.execute({ requirementId: requirement.id })).status,
            'outcome_unknown'
          );
          assert.deepEqual(await f.page.evaluate(() => window.clicks), ['wanted']);
          results.push({ scenario: 'lost-result', repeated: false, outcome: 'unknown' });
        } finally {
          await f.close();
        }
        const blocked = await fixture(browser, 'missing');
        try {
          const prototype = choiceToolPrototype([requirement], blocked.adapter);
          const responses = [
            ['apply_choice', { requirementId: requirement.id }],
            ['browser_click', { elementIndex: 1 }],
            ['ask_user_question', { question: '没有要求的选项，是否停止？' }],
          ];
          let count = 0;
          const model = new MockLanguageModelV4({
            doGenerate: async () => {
              const [name, input] = responses[count++];
              return {
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'call-' + count,
                    toolName: name,
                    input: JSON.stringify(input),
                  },
                ],
                finishReason: { unified: 'tool-calls' },
                usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
                warnings: [],
              };
            },
          });
          const response = await new ToolLoopAgent({
            model,
            tools: prototype.tools,
            onLanguageModelCallEnd: prototype.onLanguageModelCallEnd,
            maxRetries: 0,
            stopWhen: isStepCount(4),
          }).generate({ prompt: '测试要求选择' });
          assert.equal(response.toolCalls.at(-1).toolName, 'ask_user_question');
          assert.deepEqual(await blocked.page.evaluate(() => window.clicks), []);
          results.push({ scenario: 'sdk-bypass-then-question', calls: count, clicks: [] });
        } finally {
          await blocked.close();
        }
        const simultaneous = await fixture(browser, 'available');
        try {
          const prototype = choiceToolPrototype([requirement], simultaneous.adapter);
          const model = new MockLanguageModelV4({
            doGenerate: async () => ({
              content: [
                {
                  type: 'tool-call',
                  toolName: 'apply_choice',
                  toolCallId: 'effect',
                  input: JSON.stringify({ requirementId: requirement.id }),
                },
                {
                  type: 'tool-call',
                  toolName: 'ask_user_question',
                  toolCallId: 'question',
                  input: JSON.stringify({ question: '是否继续？' }),
                },
              ],
              finishReason: { unified: 'tool-calls' },
              warnings: [],
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
            }),
          });
          await new ToolLoopAgent({
            model,
            tools: prototype.tools,
            onLanguageModelCallEnd: prototype.onLanguageModelCallEnd,
            toolCallConcurrency: 1,
            maxRetries: 0,
            stopWhen: isStepCount(1),
          }).generate({ prompt: '批次冲突测试' });
          assert.deepEqual(await simultaneous.page.evaluate(() => window.clicks), []);
          assert.equal(
            prototype.trace.find((item) => item.name === 'apply_choice').result.status,
            'user_answer_required'
          );
          results.push({ scenario: 'question-and-effect-same-turn', clicks: [] });
        } finally {
          await simultaneous.close();
        }
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, flavor + '-controlled.json'),
          JSON.stringify(
            {
              flavor,
              results,
              semanticBinding: 'fixture DOM oracle; not production capability',
              rawMutationPolicy: 'all denied during this bounded phase',
              paidRequests: 0,
            },
            null,
            2
          )
        );
      } finally {
        await browser.close();
      }
    }
  );
}

if (keyFile) {
  test(
    'opt-in: live model uses bounded choice tools on four synthetic scenarios',
    { timeout: 600000 },
    async () => {
      await mkdir(directory, { recursive: true });
      const path = join(directory, 'paid-20.json');
      const report = await readFile(path, 'utf8')
        .then(JSON.parse)
        .catch((error) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          return { limit: 20, model: 'qwen3.6-flash-open', requests: [], runs: [] };
        });
      assert.equal(report.limit, 20);
      const { key } = JSON.parse(await readFile(keyFile, 'utf8'));
      assert.ok(typeof key === 'string' && key.length > 10);
      const baseURL = 'https://api.mrtoken.cn/v1';
      const catalog = await fetch(baseURL + '/models', {
        headers: { Authorization: 'Bearer ' + key },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(catalog.status, 200);
      assert.ok((await catalog.json()).data.some((item) => item.id === report.model));
      let scenario;
      const model = createOpenAICompatible({
        name: 'choice-poc',
        baseURL,
        apiKey: key,
        supportsStructuredOutputs: false,
        fetch: async (input, init) => {
          assert.equal(String(input), baseURL + '/chat/completions');
          assert.ok(report.requests.length < report.limit, 'REQUEST_LIMIT');
          const entry = { number: report.requests.length + 1, scenario, state: 'reserved' };
          report.requests.push(entry);
          await writeFile(path, JSON.stringify(report, null, 2));
          console.log(`Live choice request ${entry.number}: ${scenario}`);
          try {
            const response = await fetch(input, {
              ...init,
              redirect: 'error',
              signal: AbortSignal.timeout(45000),
            });
            const body = await response.clone().json();
            entry.state = 'received';
            entry.status = response.status;
            entry.usage = body.usage;
            entry.tools = body.choices?.[0]?.message?.tool_calls?.map((item) => item.function.name);
            return response;
          } catch {
            entry.state = 'uncertain';
            throw Error('MODEL_TRANSPORT_FAILED');
          } finally {
            await writeFile(path, JSON.stringify(report, null, 2));
          }
        },
      }).chatModel(report.model);
      const browser = await chromium.launch({
        executablePath: join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
        headless: true,
      });
      try {
        for (scenario of ['available', 'missing', 'duplicate', 'unchecked']) {
          if (report.requests.some((item) => item.scenario === scenario)) {
            continue;
          }
          const f = await fixture(browser, scenario);
          try {
            const wanted = { ...requirement };
            if (scenario === 'unchecked') {
              wanted.role = 'checkbox';
              wanted.checked = false;
            }
            const prototype = choiceToolPrototype([wanted], f.adapter);
            const result = await new ToolLoopAgent({
              model,
              tools: prototype.tools,
              onLanguageModelCallEnd: prototype.onLanguageModelCallEnd,
              maxRetries: 0,
              toolCallConcurrency: 1,
              stopWhen: [isStepCount(5), prototype.finished],
              maxOutputTokens: 1800,
              instructions:
                '完成当前选择阶段，按workflow中的要求调用apply_choice。满足后finish_run。目标缺失或歧义时ask_user_question，不擅自替换。不得用原始点击/填写绕过要求。此任务不包含提交业务。',
            }).generate({ prompt: JSON.stringify({ workflow: { choices: [wanted] } }) });
            const clicks = await f.page.evaluate(() => window.clicks);
            const asked = result.toolCalls.some((call) => call.toolName === 'ask_user_question');
            const expected = scenario === 'available' || scenario === 'unchecked';
            const passed = expected
              ? prototype.finished() && clicks.length === 1 && clicks[0] === 'wanted'
              : asked && clicks.length === 0;
            report.runs.push({
              scenario,
              passed,
              asked,
              finished: prototype.finished(),
              trace: prototype.trace,
              clicks,
            });
            await writeFile(path, JSON.stringify(report, null, 2));
          } finally {
            await f.close();
          }
        }
        assert.equal(report.runs.length, 4);
        assert.ok(
          report.runs.every((run) => run.passed),
          'Keep failures; do not rerun paid scenarios'
        );
      } finally {
        await browser.close();
      }
    }
  );
}
