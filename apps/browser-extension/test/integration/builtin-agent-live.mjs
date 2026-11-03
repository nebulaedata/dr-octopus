/**
 * @author Codex
 * @description Opt-in real-model acceptance through isolated native panels and production Worker/Controller, with a durable global request cap.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';
/* global chrome */

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: {
    'key-file': { type: 'string' },
    evidence: { type: 'string' },
  },
});
assert.ok(values['key-file'], 'Explicit authorized external --key-file is required');
const evidence = resolve(
  values.evidence ?? join(root, 'build/validation-evidence/builtin-agent-live', randomUUID())
);
assert.ok(
  relative(join(root, 'build'), evidence) && !relative(join(root, 'build'), evidence).startsWith('..')
);
await mkdir(evidence, { recursive: true });
const reportPath = join(evidence, 'report.json');
const report = await readFile(reportPath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({
    version: 1,
    model: 'qwen3.6-flash-open',
    limit: 30,
    startedAt: new Date().toISOString(),
    requests: [],
    runs: [],
  }));
assert.equal(report.limit, 30);
const { key } = JSON.parse(await readFile(resolve(values['key-file']), 'utf8'));
assert.ok(typeof key === 'string' && key.length > 10);
const upstream = 'https://api.mrtoken.cn/v1';

/**
 * Writes only synthetic task data and safe response metadata, never authorization or upstream bodies.
 */
async function persist() {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}

const discovery = await fetch(upstream + '/models', {
  headers: { Authorization: 'Bearer ' + key },
  signal: AbortSignal.timeout(30000),
  redirect: 'error',
});
assert.equal(discovery.status, 200, 'Model discovery failed');
const catalog = await discovery.json();
assert.ok(
  catalog.data.some((item) => item.id === report.model),
  'Authorized exact model is unavailable'
);
report.discovery = { status: 200, exactModelFound: true };
report.sources = {};
for (const file of ['builtin-agent.ts', 'builtin-host.ts', 'builtin-service.ts']) {
  report.sources[file] = createHash('sha256')
    .update(await readFile(join(root, 'src/lib/builtin-agent', file)))
    .digest('hex');
}
await persist();

let inFlight = 0;
const proxy = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/orders') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><title>合成订单查询</title><h1>合成订单查询</h1><label>订单编号<input id="order" aria-label="订单编号"></label><button id="query">查询</button><p id="result" role="status"></p><script>window.queryCount=0;query.onclick=()=>{window.queryCount++;result.textContent="订单"+order.value+"：待处理"}</script>'
    );
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let entry;
  let forwarded = false;
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      assert.ok(raw.length < 2 * 1024 * 1024);
    }
    const body = JSON.parse(raw);
    assert.equal(body.model, report.model);
    assert.equal(body.stream ?? false, false);
    if (report.requests.length >= report.limit) {
      res.writeHead(429).end('{"error":{"message":"LIVE_TEST_REQUEST_CAP"}}');
      return;
    }
    entry = {
      number: report.requests.length + 1,
      startedAt: new Date().toISOString(),
      status: 'reserved',
      mode: body.tools.some((t) => t.function.name === 'read_recording') ? 'organize' : 'replay',
    };
    report.requests.push(entry);
    await persist(); // Reserve durably BEFORE sending; uncertain requests consume the allowance too.
    inFlight++;
    forwarded = true;
    console.log(JSON.stringify({ request: entry.number, mode: entry.mode, status: 'sent' }));
    const response = await fetch(upstream + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: raw,
      signal: AbortSignal.timeout(65000),
      redirect: 'error',
    });
    const bytes = await response.text();
    entry.httpStatus = response.status;
    entry.status = 'received';
    entry.elapsedMs = Date.now() - Date.parse(entry.startedAt);
    const parsed = JSON.parse(bytes);
    const choice = parsed.choices?.[0];
    entry.finishReason = choice?.finish_reason ?? null;
    entry.tools = choice?.message?.tool_calls?.map((c) => c.function.name) ?? [];
    entry.textLength = choice?.message?.content?.length ?? 0;
    entry.usage = parsed.usage ?? null;
    await persist();
    console.log(
      JSON.stringify({
        request: entry.number,
        http: entry.httpStatus,
        tools: entry.tools,
        finish: entry.finishReason,
      })
    );
    res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(bytes);
  } catch (error) {
    if (entry) {
      entry.status = 'transport_failed';
      entry.error = error.name;
      await persist();
    }
    res
      .writeHead(502, { 'Content-Type': 'application/json' })
      .end('{"error":{"message":"LIVE_TEST_TRANSPORT_FAILURE"}}');
  } finally {
    if (forwarded) {
      inFlight--;
    }
  }
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + proxy.address().port;
let generatedBinding;

/**
 * Runs actual extension code in a fresh installed-browser profile; only the Native Host name is isolated.
 */
async function runBrowser(flavor, organize) {
  const temporary = await mkdtemp(join(tmpdir(), 'octopus-live-builtin-'));
  let context;
  try {
    const extension = join(temporary, 'extension');
    await cp(join(root, '.output', flavor + '-mv3'), extension, { recursive: true });
    const { identity } = JSON.parse(await readFile(join(extension, 'browser-identity.json'), 'utf8'));
    const manifestFile = join(extension, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    await writeFile(manifestFile, JSON.stringify({ ...manifest, key: identity.sideloadPublicKey }));
    const background = join(extension, 'background.js');
    await writeFile(
      background,
      (await readFile(background, 'utf8')).replace(
        'com.octopus.executor.browser',
        'com.octopus.test.live_unregistered'
      )
    );
    context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      executablePath:
        flavor === 'chrome'
          ? join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe')
          : join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--window-position=-2000,-2000', '--no-first-run'],
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
    const worker =
      context.serviceWorkers().find((w) => w.url().includes(id)) ??
      (await context.waitForEvent('serviceworker'));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(async () => {
      const current = await chrome.windows.getCurrent();
      const button = document.createElement('button');
      button.id = 'live-open-panel';
      button.textContent = 'Open test panel';
      button.style.cssText = 'position:fixed;top:0;right:0;z-index:9999';
      button.onclick = () => chrome.sidePanel.open({ windowId: current.id });
      document.body.append(button);
    });
    await popup.locator('#live-open-panel').click({ force: true });
    await expect
      .poll(async () =>
        (await cdp.send('Target.getTargets')).targetInfos.some((t) =>
          t.url.includes('window-panel.html?instance=')
        )
      )
      .toBe(true);
    const target = (await cdp.send('Target.getTargets')).targetInfos.find((t) =>
      t.url.includes('window-panel.html?instance=')
    );
    const attachment = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let sequence = 0;
    /**
     * Sends an evaluation only to the actual SIDE_PANEL target, preserving production source checks.
     */
    async function evaluate(expression) {
      const sequenceId = ++sequence;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cdp.off('Target.receivedMessageFromTarget', receive);
          reject(Error('PANEL_EVALUATION_TIMEOUT'));
        }, 15000);
        /**
         * Matches the response for this isolated CDP request.
         */
        function receive(event) {
          if (event.sessionId !== attachment.sessionId) {
            return;
          }
          const message = JSON.parse(event.message);
          if (message.id !== sequenceId) {
            return;
          }
          clearTimeout(timer);
          cdp.off('Target.receivedMessageFromTarget', receive);
          if (message.result?.exceptionDetails) {
            reject(Error('PANEL_EVALUATION_FAILED'));
            return;
          }
          resolve(message.result?.result?.value);
        }
        cdp.on('Target.receivedMessageFromTarget', receive);
      });
      await cdp.send('Target.sendMessageToTarget', {
        sessionId: attachment.sessionId,
        message: JSON.stringify({
          id: sequenceId,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      });
      return result;
    }
    await expect
      .poll(() => evaluate("Boolean(document.querySelector('button[aria-label=会话历史]'))"))
      .toBe(true);
    const recordingId = randomUUID();
    await worker.evaluate(
      async ({ origin, recordingId, model, binding }) => {
        const now = Date.now();
        const db = await new Promise((resolve) => {
          const r = indexedDB.open('octopus-recordings', 2);
          r.onsuccess = () => resolve(r.result);
        });
        const events = ['input', 'click'].map((action, index) => ({
          id: crypto.randomUUID(),
          sessionId: recordingId,
          seq: index + 1,
          tabRef: 'tab-1',
          documentId: 'document-1',
          source: 'dom',
          at: now + index,
          action,
          label: index ? '查询' : '订单编号',
          url: origin + '/orders',
          targetRef: 'control-' + index,
          ...(index ? {} : { editRef: 'edit-1', redacted: true, role: 'textbox' }),
        }));
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['sessions', 'events'], 'readwrite');
          tx.objectStore('sessions').put({
            id: recordingId,
            name: '按订单编号查询状态（仅查询，不付款、不提交订单）',
            status: 'stopped',
            startedAt: now,
            updatedAt: now,
            elapsedMs: 1000,
            resumedAt: null,
            windowId: 1,
            origins: [origin],
            includeRelated: false,
            pages: [{ tabId: 1, tabRef: 'tab-1', origin, title: '订单查询', lastBatch: 1, included: true }],
            epoch: 1,
            count: 2,
            actionCount: 2,
            recentEvents: [],
            bytes: 500,
            gaps: [],
          });
          for (const event of events) {
            tx.objectStore('events').put(event);
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        await chrome.storage.local.set({
          workflowSettings: { provider: 'openai-compatible', baseUrl: origin + '/v1', model },
          workflowConsents: { ['openai-compatible:' + origin + '/v1']: 2 },
          skillExecutionLimits: { organize: 10, replay: 14 },
        });
        if (binding) {
          const skills = await new Promise((resolve) => {
            const r = indexedDB.open('octopus-skill-sessions', 4);
            r.onsuccess = () => resolve(r.result);
          });
          await new Promise((resolve) => {
            const tx = skills.transaction('bindings', 'readwrite');
            tx.objectStore('bindings').put({ ...binding, recordingId });
            tx.oncomplete = resolve;
          });
          skills.close();
        }
      },
      { origin, recordingId, model: report.model, binding: generatedBinding }
    );
    /**
     * Executes a real organization/replay session and answers only bounded synthetic test questions.
     */
    async function execute(mode) {
      const start = await evaluate(
        `chrome.runtime.sendMessage(${JSON.stringify({ type: 'skill.start', recordingId, mode, consent: { baseUrl: origin + '/v1', model: report.model } })})`
      );
      assert.equal(start.ok, true, start.error);
      const run = {
        browser: flavor,
        mode,
        sessionId: start.value.id,
        startedAt: new Date().toISOString(),
        requestStart: report.requests.length,
      };
      report.runs.push(run);
      await persist();
      let session;
      const answered = new Set();
      const deadline = Date.now() + 12 * 60000;
      while (Date.now() < deadline) {
        session = await evaluate(
          `chrome.runtime.sendMessage({type:'skill.get',id:'${run.sessionId}'}).then(r=>r.value)`
        );
        if (
          session.status === 'waiting_user' &&
          !session.hostWindowId &&
          !answered.has(session.pendingQuestion.toolCallId)
        ) {
          const question = session.pendingQuestion;
          const answer = {};
          for (const field of question.question.fields) {
            // A scoped explanation avoids guessing a technical enum or satisfying an irrelevant required field.
            answer[field.id] =
              mode === 'organize'
                ? {
                    kind: 'explanation',
                    text: '用途是按订单编号查询状态。订单编号每次重放时由用户输入；只读取查询结果，不进行付款、创建或修改订单。请据录制自主整理，其余采用合理默认。',
                  }
                : field.type === 'text'
                  ? '000123'
                  : {
                      kind: 'explanation',
                      text: '本次查询编号000123，只查询并报告页面上的待处理状态，无需其他输入或业务操作。',
                    };
          }
          const reply = await evaluate(
            `chrome.runtime.sendMessage(${JSON.stringify({
              type: 'skill.answer',
              id: session.id,
              epoch: session.epoch,
              revision: session.revision,
              submissionId: randomUUID(),
              toolCallId: question.toolCallId,
              answer: { status: 'answered', values: answer },
            })})`
          );
          if (reply.ok) {
            answered.add(question.toolCallId);
            console.log(
              JSON.stringify({ browser: flavor, mode, event: 'answered', fields: Object.keys(answer) })
            );
          }
        }
        if (
          ['completed', 'failed', 'cancelled', 'interrupted', 'outcome_unknown', 'saving'].includes(
            session.status
          ) &&
          !session.hostWindowId
        ) {
          break;
        }
        // The relay refuses request 31 before forwarding. Do not cancel request 30 while it is in flight.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (['running', 'waiting_user'].includes(session.status)) {
        await evaluate(
          `chrome.runtime.sendMessage({type:'skill.cancel',id:'${session.id}',epoch:'${session.epoch}'})`
        );
        session = await evaluate(
          `chrome.runtime.sendMessage({type:'skill.get',id:'${session.id}'}).then(r=>r.value)`
        );
        run.harnessTimeout = true;
      }
      run.status = session.status;
      run.error = session.error ?? null;
      run.modelCalls = session.modelCalls;
      run.tools = Object.values(session.ledger).map((e) => ({
        name: e.toolName,
        state: e.state,
        error:
          e.result?.output.type === 'json'
            ? (e.result.output.value?.error ?? null)
            : (e.result?.output.value ?? null),
      }));
      run.answers = answered.size;
      run.requestEnd = report.requests.length;
      await writeFile(
        join(evidence, `${flavor}-${mode}-${session.id}.json`),
        JSON.stringify(session, null, 2)
      );
      await persist();
      console.log(
        JSON.stringify({
          browser: flavor,
          mode,
          status: run.status,
          modelCalls: run.modelCalls,
          error: run.error,
        })
      );
      if (run.status === 'completed' && mode === 'organize') {
        generatedBinding = await worker.evaluate(async (recordingId) => {
          const db = await new Promise((resolve) => {
            const r = indexedDB.open('octopus-skill-sessions', 4);
            r.onsuccess = () => resolve(r.result);
          });
          const value = await new Promise((resolve) => {
            const r = db.transaction('bindings').objectStore('bindings').get(recordingId);
            r.onsuccess = () => resolve(r.result);
          });
          db.close();
          return value;
        }, recordingId);
        await writeFile(join(evidence, 'generated-binding.json'), JSON.stringify(generatedBinding, null, 2));
      }
      if (mode === 'replay') {
        const page = context.pages().find((p) => p.url() === origin + '/orders');
        run.page = page
          ? await page.evaluate(() => ({
              queryCount: window.queryCount,
              input: document.querySelector('#order').value,
              result: document.querySelector('#result').textContent,
            }))
          : null;
        await persist();
      }
      return run.status;
    }
    if (organize) {
      await execute('organize');
    }
    if (generatedBinding && report.requests.length < report.limit - 3) {
      await execute('replay');
    }
  } finally {
    await context?.close();
    assert.ok(temporary.startsWith(join(tmpdir(), 'octopus-live-builtin-')));
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await runBrowser('chrome', true);
  if (generatedBinding && report.requests.length <= report.limit - 6) {
    await runBrowser('edge', false);
  }
} catch (error) {
  report.harnessError = {
    name: error.name,
    code: /^[A-Z_]+$/.test(error.message) ? error.message : 'HARNESS_ERROR',
  };
  console.log(JSON.stringify(report.harnessError));
  process.exitCode = 1;
} finally {
  while (inFlight > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proxy.closeAllConnections();
  await new Promise((resolve) => proxy.close(resolve));
  report.finishedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify({ evidence, realModelRequests: report.requests.length, limit: report.limit }));
}
