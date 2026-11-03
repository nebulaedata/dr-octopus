/**
 * @author Codex
 * @description Reads a selected session from a stable copied IndexedDB in an isolated browser, emitting only lifecycle and tool metadata.
 */
import { readdir, stat, cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
const sessionId = process.env.INSPECT_SESSION_ID;
const evidence = process.env.INSPECT_EVIDENCE;
if (!sessionId || !/^[a-f0-9-]{36}$/.test(sessionId) || !evidence) {
  throw Error('EXPLICIT_SESSION_REQUIRED');
}
const extensionId = 'oigkjlnafjdkoknajgeboknaoemkcbfj';
const databaseName = `chrome-extension_${extensionId}_0.indexeddb.leveldb`;
const source = join(process.env.LOCALAPPDATA, 'Google/Chrome/User Data/Default/IndexedDB', databaseName);
const directory = await mkdtemp(join(tmpdir(), 'octopus-lifecycle-readonly-'));
let context;
/**
 * Rejects a concurrently changing source instead of treating a torn copy as authoritative.
 */
async function signature() {
  const files = (await readdir(source)).filter((name) => name !== 'LOCK').sort();
  return JSON.stringify(
    await Promise.all(
      files.map(async (name) => {
        const value = await stat(join(source, name));
        return [name, value.size, value.mtimeMs];
      })
    )
  );
}
try {
  const before = await signature();
  await cp(source, join(directory, 'profile/Default/IndexedDB', databaseName), {
    recursive: true,
    filter: (path) => !path.endsWith(sep + 'LOCK'),
  });
  if (before !== (await signature())) {
    throw Error('SOURCE_CHANGED_DURING_COPY');
  }
  const reader = join(directory, 'reader');
  await mkdir(reader);
  const manifest = JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8'));
  await writeFile(
    join(reader, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Read-only lifecycle inspector',
      version: '1.0.0',
      key: manifest.key,
      background: { service_worker: 'worker.js' },
    })
  );
  await writeFile(join(reader, 'worker.js'), 'chrome.runtime.onInstalled.addListener(()=>{});');
  context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    executablePath: join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: reader });
  if (id !== extensionId) {
    throw Error('EXTENSION_ID_MISMATCH');
  }
  const worker =
    context.serviceWorkers().find((worker) => worker.url().includes(id)) ??
    (await context.waitForEvent('serviceworker'));
  const report = await worker.evaluate(async (sessionId) => {
    const databases = await indexedDB.databases();
    if (!databases.some((db) => db.name === 'octopus-skill-sessions')) {
      return { found: false };
    }
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('octopus-skill-sessions');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const session = await new Promise((resolve, reject) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!session) {
      return { found: false };
    }
    return {
      found: true,
      sessionId,
      status: session.status,
      epoch: session.epoch,
      revision: session.revision,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sessionError: session.error ?? null,
      windowId: session.windowId,
      panelDocumentId: session.panelDocumentId,
      hostWindowId: session.hostWindowId,
      hostDocumentId: session.hostDocumentId,
      hostDelivered: session.hostDelivered,
      modelCalls: session.modelCalls,
      responses: session.responses,
      toolMessages: session.messages.flatMap((message, messageIndex) =>
        Array.isArray(message.content)
          ? message.content
              .filter((part) => part.type === 'tool-result')
              .map((part) => ({
                messageIndex,
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                outputType: part.output?.type,
                errorCode:
                  part.output?.type === 'error-text' && /^(?:Error: )?[A-Z_]+$/.test(part.output.value)
                    ? part.output.value
                    : undefined,
                errorLength: part.output?.type === 'error-text' ? part.output.value.length : undefined,
              }))
          : []
      ),
      ledger: Object.values(session.ledger).map((entry) => ({
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        state: entry.state,
        tabId: entry.input?.tabId,
        code:
          entry.result?.output.type === 'error-text'
            ? entry.result.output.value
            : entry.result?.output.value?.error,
        resultKeys: entry.result?.output.type === 'json' ? Object.keys(entry.result.output.value ?? {}) : [],
      })),
    };
  }, sessionId);
  await writeFile(join(evidence, 'session-lifecycle.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  const target = resolve(directory);
  if (target.startsWith(resolve(tmpdir()) + sep + 'octopus-lifecycle-readonly-')) {
    await rm(target, { recursive: true, force: true });
  } else {
    console.error('INVALID_CLEANUP_TARGET');
    process.exitCode = 1;
  }
}
