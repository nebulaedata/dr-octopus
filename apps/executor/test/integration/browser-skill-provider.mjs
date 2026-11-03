/**
 * @author Codex
 * @description Supplies a deterministic local tool-calling provider and owned order page for real browser Skill acceptance.
 */
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

/**
 * Selects the newest actual tool result by its SDK call identity.
 */
function results(messages) {
  const names = new Map();
  const entries = [];
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name);
    }
    if (message.role === 'tool') {
      let value;
      try {
        value = JSON.parse(message.content);
      } catch {
        value = message.content;
      }
      entries.push({ id: message.tool_call_id, name: names.get(message.tool_call_id), value });
    }
  }
  return entries;
}

/**
 * Derives a real PageController element index from its published observation text.
 */
function target(snapshot, label, tag) {
  const line = snapshot.text
    .split('\n')
    .find((value) => value.includes(label) && value.includes('<' + tag + ' ') && /\[\d+\]/.test(value));
  assert.ok(line, `Missing ${label}: ${snapshot.text}`);
  return {
    documentId: snapshot.documentId,
    controllerId: snapshot.controllerId,
    snapshotId: snapshot.snapshotId,
    elementIndex: Number(line.match(/\[(\d+)\]/)[1]),
  };
}

/**
 * Runs only synthetic local requests; the test never reads the configured real provider or credential file.
 */
export async function createSkillProvider() {
  let url;
  let sequence = 0;
  const calls = [];
  const control = { requireEditedSkill: false };
  const errors = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><html><head><title>订单查询测试</title></head><body><h1>订单查询测试</h1><label>订单编号<input aria-label="订单编号" id="order"></label><button id="query">查询</button><p id="result"></p><script>window.queryCount=0;document.querySelector("#query").onclick=()=>{window.queryCount++;document.querySelector("#result").textContent="订单"+document.querySelector("#order").value+"：待处理"}</script></body></html>'
      );
      return;
    }
    try {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        assert.ok(raw.length < 2 * 1024 * 1024);
      }
      const input = JSON.parse(raw);
      const history = results(input.messages);
      const last = (name) => history.filter((item) => item.name === name).at(-1)?.value;
      let name;
      let args;
      const organizing = input.tools.some((tool) => tool.function.name === 'read_recording');
      if (organizing) {
        const candidate = {
          skillMarkdown:
            '---\nname: 订单查询\ndescription: 按订单编号查询并报告页面显示的状态。\n---\n在订单查询页面填写{{orderNo}}，点击查询，读取并报告订单状态。只查询，不修改订单。',
          workflow: {
            schemaVersion: 1,
            inputs: [{ name: 'orderNo', label: '订单编号', type: 'text', required: true }],
            allowedOrigins: [url],
            pages: [{ role: 'search', startUrl: url + '/orders' }],
            execution: { maxModelCalls: 20 },
            evidence: [{ ref: 'action-1', kind: 'input', targetHint: '订单编号' }],
          },
        };
        if (!last('read_recording')) {
          name = 'read_recording';
          args = { offset: 0, limit: 20 };
        } else if (!last('ask_user_question')) {
          name = 'ask_user_question';
          args = {
            question: '这个流程按什么编号查询？',
            fields: [
              {
                id: 'kind',
                label: '查询对象',
                type: 'single',
                required: true,
                options: [
                  { id: 'order', label: '订单编号' },
                  { id: 'customer', label: '客户编号' },
                ],
              },
            ],
            allowDefer: false,
          };
        } else if (!last('validate_skill')) {
          name = 'validate_skill';
          args = candidate;
        } else {
          assert.equal(last('validate_skill').valid, true, JSON.stringify(last('validate_skill')));
          name = 'submit_skill';
          args = candidate;
        }
      } else {
        if (last('read_skill') && control.requireEditedSkill) {
          assert.ok(
            last('read_skill').candidate.skillMarkdown.includes('用户维护标记'),
            'Replay must reload the user-edited Skill'
          );
        }
        const observed = last('browser_snapshot');
        const tabId = last('browser_tabs')?.tabs.find((tab) => tab.url.startsWith(url + '/orders'))?.tabId;
        if (!last('read_skill')) {
          name = 'read_skill';
          args = {};
        } else if (!last('browser_tabs')) {
          name = 'browser_tabs';
          args = {};
        } else if (!observed) {
          assert.ok(Number.isInteger(tabId));
          name = 'browser_snapshot';
          args = { tabId, screenshot: false };
        } else if (!last('ask_user_question')) {
          name = 'ask_user_question';
          args = {
            question: '这次查询哪个订单？',
            fields: [{ id: 'orderNo', label: '订单编号', type: 'text', required: true, maxLength: 100 }],
            allowDefer: false,
          };
        } else if (['ask_user_question', 'browser_fill', 'browser_click'].includes(history.at(-1).name)) {
          name = 'browser_snapshot';
          args = { tabId, screenshot: false };
        } else if (!last('browser_fill')) {
          name = 'browser_fill';
          args = {
            tabId,
            target: target(observed, '订单编号', 'input'),
            text: last('ask_user_question').values.orderNo,
          };
        } else if (!last('browser_click')) {
          name = 'browser_click';
          args = { tabId, target: target(observed, '查询', 'button') };
        } else if (control.requireEditedSkill && !last('browser_open_tab')) {
          assert.ok(observed.text.includes('000123'), observed.text);
          name = 'browser_open_tab';
          args = { url: url + '/receipt', background: true };
        } else if (history.at(-1).name === 'browser_open_tab') {
          name = 'browser_snapshot';
          args = { tabId: last('browser_open_tab').tabId, screenshot: false };
        } else if (control.requireEditedSkill && !last('browser_close_tab')) {
          name = 'browser_close_tab';
          args = { tabId: last('browser_open_tab').tabId };
        } else {
          if (control.requireEditedSkill) {
            assert.equal(last('browser_close_tab').businessEffect, 'applied');
          } else {
            assert.ok(observed.text.includes('000123'));
          }
          name = 'finish_run';
          args = {
            summary: '页面显示订单000123：待处理。',
            outcome: 'completed',
            evidenceCallId: history
              .filter(
                (item) =>
                  item.name === (control.requireEditedSkill ? 'browser_close_tab' : 'browser_snapshot')
              )
              .at(-1).id,
          };
        }
      }
      calls.push({ mode: organizing ? 'organize' : 'replay', tool: name });
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          id: 'synthetic-' + ++sequence,
          model: input.model,
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_' + sequence,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })
      );
    } catch (error) {
      errors.push(error.message);
      response.writeHead(500);
      response.end(JSON.stringify({ error: { message: 'Synthetic fixture failed' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port;
  return { server, url, calls, errors, control };
}
