/**
 * @author Codex
 * @description Verifies real remote MCP file transfers with OS curl, private credentials and on-disk binary fixtures; refuses local interfaces and never reports file bodies or tokens.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomFillSync, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NativeFileCommit, networkAddressSchema } from '../../build/tooling/application-api.mjs';
import { fileURLToPath } from 'node:url';

/**
 * Computes exact local disk bytes without returning binary data to the caller or model.
 */
async function digest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Creates an owned binary file in bounded blocks with exclusive creation and an exact digest.
 */
async function fixture(path, bytes) {
  const file = await open(path, 'wx');
  const block = randomFillSync(Buffer.alloc(Math.min(1024 ** 2, bytes)));
  try {
    for (let offset = 0; offset < bytes; offset += block.length) {
      await file.writeFile(block.subarray(0, Math.min(block.length, bytes - offset)));
    }
    await file.sync();
  } finally {
    await file.close();
  }
  return digest(path);
}

/**
 * Reads one user-supplied HTTP configuration without printing or executing any of its contents.
 */
async function configuration(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    assert.ok(info.isFile() && info.size <= 65536 && info.nlink === 1, 'Invalid private configuration file.');
    const bytes = Buffer.alloc(65537);
    const read = await file.read(bytes, 0, bytes.length, 0);
    assert.ok(read.bytesRead <= 65536, 'Configuration exceeds limit.');
    const value = JSON.parse(
      bytes
        .subarray(0, read.bytesRead)
        .toString('utf8')
        .replace(/^\ufeff/, '')
    );
    const servers = Object.values(value.mcpServers ?? {});
    assert.equal(servers.length, 1, 'Provide exactly one intended remote Executor.');
    const server = servers[0];
    assert.equal(typeof server.url, 'string');
    assert.match(server.headers?.Authorization ?? '', /^Bearer [a-f0-9]{64}$/);
    const endpoint = new URL(server.url);
    networkAddressSchema.parse(endpoint.hostname);
    assert.ok(
      endpoint.protocol === 'http:' &&
        endpoint.pathname === '/mcp' &&
        !endpoint.search &&
        !endpoint.hash &&
        !endpoint.username &&
        !endpoint.password
    );
    const local = Object.values(networkInterfaces())
      .flat()
      .filter(Boolean)
      .map((item) => item.address);
    assert.ok(
      !local.includes(endpoint.hostname),
      'Real cross-machine acceptance refuses local network interfaces.'
    );
    return { endpoint, authorization: server.headers.Authorization };
  } finally {
    await file.close();
  }
}

/**
 * Binds temporary byte instructions to the authenticated remote origin, transfer and expected direction.
 */
function content(record, endpoint, method) {
  assert.equal(record.content?.method, method);
  const url = new URL(record.content.url);
  assert.equal(url.origin, endpoint.origin);
  assert.equal(url.pathname, '/transfers/' + record.transferId + '/content');
  assert.ok(!url.search && !url.hash && !url.username && !url.password);
  assert.match(record.content.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  return record.content;
}

/**
 * Uses curl with an ACL-protected config so temporary credentials never appear in process arguments or logs.
 */
async function curl(native, output, instructions, source, destination, limitRate) {
  const configPath = join(output, 'curl-' + randomUUID() + '.private');
  const lines = [
    'silent',
    'show-error',
    'fail',
    'max-time = 180',
    'url = ' + JSON.stringify(instructions.url),
    'request = ' + JSON.stringify(instructions.method),
    'header = ' + JSON.stringify('Authorization: ' + instructions.headers.Authorization),
    'output = ' + JSON.stringify(destination),
    'write-out = "%{http_code} %{size_upload} %{size_download} %{time_total}"',
    ...(source ? ['upload-file = ' + JSON.stringify(source)] : ['no-clobber']),
    ...(limitRate ? ['limit-rate = ' + limitRate] : []),
  ];
  const created = await native.writePrivateConfig(configPath, lines.join('\n'));
  assert.ok(created.ok && created.privateAcl, 'Could not create private curl instructions.');
  const child = spawn(join(process.env.SystemRoot, 'System32/curl.exe'), ['--config', configPath], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (bytes) => {
    stdout = (stdout + bytes.toString()).slice(-4096);
  });
  child.stderr.resume();
  const finished = new Promise((resolve) => {
    child.once('error', () => resolve({ exitCode: -1, http: 0 }));
    child.once('close', (exitCode) => {
      const [http, uploadBytes, downloadBytes, seconds] = stdout.trim().split(/\s+/).map(Number);
      resolve({ exitCode, http, uploadBytes, downloadBytes, seconds });
    });
  }).finally(async () => {
    const after = await native.inspect(configPath);
    assert.ok(
      after.ok && after.identity === created.identity && after.links === 1,
      'Private curl file identity changed.'
    );
    await unlink(configPath);
  });
  return { finished, stop: () => child.kill() };
}

/**
 * Runs only task-scoped transfers against an existing remote directory and writes metadata-only evidence.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      'remote-directory': { type: 'string' },
      'output-directory': { type: 'string' },
      'expected-host': { type: 'string' },
      'expected-device-name': { type: 'string' },
    },
  });
  assert.ok(
    values.config && values['remote-directory'] && values['output-directory'],
    'Provide --config, --remote-directory and a fresh --output-directory.'
  );
  assert.ok(
    win32.isAbsolute(values['remote-directory']) && !values['remote-directory'].includes('\0'),
    'Remote directory must be an absolute Windows path.'
  );
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const output = resolve(values['output-directory']);
  const created = await native.createRecovery(output);
  assert.ok(created.ok && created.privateAcl, 'Evidence directory must be new, ordinary and private.');
  const report = {
    schemaVersion: 1,
    sourceComputer: hostname(),
    startedAt: new Date().toISOString(),
    passed: false,
    cases: [],
    checks: {},
    taskEnded: false,
    sessionClosed: false,
  };
  const runId = randomUUID();
  const activeCurl = new Set();
  let phase = 'configuration';
  let client;
  let taskId;
  let openTransfer;
  /**
   * Calls discovered metadata tools and deliberately excludes raw tool errors and credentials from report output.
   */
  const call = async (name, args) => {
    phase = name;
    const reply = await client.callTool({ name, arguments: args });
    assert.notEqual(reply.isError, true, 'Remote tool refused: ' + name);
    return reply.structuredContent.data;
  };
  /**
   * Observes original transfer identity until the requested state, honoring its polling interval without replay.
   */
  const settle = async (transferId, desired) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const record = await call('file_transfer_status', { transferId });
      if (record.status === desired) {
        return record;
      }
      assert.ok(
        !['failed', 'cancelled', 'expired', 'unknown'].includes(record.status),
        'Transfer terminated before ' + desired
      );
      await delay(record.pollAfterMs);
    }
    throw new Error('Transfer polling deadline exceeded.');
  };
  try {
    const { endpoint, authorization } = await configuration(values.config);
    assert.equal(
      endpoint.hostname,
      values['expected-host'],
      'Configuration does not name the intended remote host.'
    );
    report.endpoint = endpoint.href;
    client = new Client({ name: 'external-Agent-cross-machine-acceptance', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: authorization } },
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
      })
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of [
      'file_upload_prepare',
      'file_download_prepare',
      'file_transfer_status',
      'file_transfer_cancel',
    ]) {
      assert.ok(names.includes(name));
    }
    const status = await call('runtime_status', {});
    report.device = status.device;
    assert.equal(
      status.device?.deviceName,
      values['expected-device-name'],
      'Remote device name does not match the intended target.'
    );
    report.shell = status.shell;
    report.grantedCapabilities = status.capabilities;
    const task = await call('task_start', {
      cwd: values['remote-directory'],
      capabilities: ['files.write'],
      idempotencyKey: 'cross-machine-' + runId,
    });
    taskId = task.taskId;
    report.taskId = taskId;
    report.taskCapabilities = ['files.write'];
    await call('ls', { taskId, path: values['remote-directory'], limit: 100 });
    let cancellableSource;
    for (const [index, size] of [0, 8 * 1024 ** 2 + 37, 64 * 1024 ** 2 + 19].entries()) {
      phase = 'local-fixture-' + index;
      const source = join(output, '本机 source-' + index + '.bin');
      const expected = await fixture(source, size);
      if (index === 1) {
        cancellableSource = source;
      }
      const remote = win32.join(values['remote-directory'], '跨机 file-' + runId + '-' + index + '.bin');
      const input = {
        taskId,
        path: remote,
        totalBytes: size,
        sha256: expected.sha256,
        idempotencyKey: 'upload-' + index,
      };
      const initial = await call('file_upload_prepare', input);
      openTransfer = initial.transferId;
      const prepared = await settle(openTransfer, 'ready');
      const instructions = content(prepared, endpoint, 'PUT');
      if (index === 0) {
        for (const [name, url, headers, method, expectedStatus] of [
          ['anonymousBytesRejected', instructions.url, {}, 'PUT', 401],
          ['deviceBearerRejectedByBytes', instructions.url, { Authorization: authorization }, 'PUT', 401],
          ['temporaryBearerRejectedByMcp', endpoint.href, instructions.headers, 'GET', 401],
          ['wrongDirectionRejected', instructions.url, instructions.headers, 'GET', 409],
        ]) {
          const response = await fetch(url, {
            method,
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          assert.equal(response.status, expectedStatus, name);
          await response.body?.cancel();
          report.checks[name] = true;
        }
      }
      assert.equal((await call('file_upload_prepare', input)).transferId, initial.transferId);
      const upload = await curl(
        native,
        output,
        instructions,
        source,
        join(output, 'upload-reply-' + index + '.json')
      );
      activeCurl.add(upload);
      const sent = await upload.finished;
      activeCurl.delete(upload);
      assert.equal(sent.exitCode, 0, 'curl upload failed.');
      assert.equal(sent.http, 200);
      const published = await settle(initial.transferId, 'completed');
      assert.equal(published.destinationEffect, 'applied');
      assert.equal(published.sha256, expected.sha256);
      assert.equal(published.content, undefined);
      const download = await call('file_download_prepare', {
        taskId,
        path: remote,
        idempotencyKey: 'download-' + index,
      });
      openTransfer = download.transferId;
      const snapshot = await settle(openTransfer, 'ready');
      assert.equal(snapshot.sha256, expected.sha256);
      const staging = join(output, 'download-' + index + '.part');
      const receiving = await curl(native, output, content(snapshot, endpoint, 'GET'), undefined, staging);
      activeCurl.add(receiving);
      const received = await receiving.finished;
      activeCurl.delete(receiving);
      assert.equal(received.exitCode, 0, 'curl download failed.');
      assert.equal(received.http, 200);
      await settle(download.transferId, 'completed');
      const actual = await digest(staging);
      assert.deepEqual(actual, expected);
      const destination = join(output, '本机 received-' + index + '.bin');
      await rename(staging, destination);
      openTransfer = undefined;
      report.cases.push({
        bytes: size,
        sha256: expected.sha256,
        remotePath: remote,
        uploadTransferId: initial.transferId,
        downloadTransferId: download.transferId,
        uploaded: sent,
        downloaded: received,
        localFileVerified: true,
      });
      console.info(
        JSON.stringify({ case: index, bytes: size, sha256: expected.sha256, roundTripVerified: true })
      );
    }
    const cancelPath = win32.join(values['remote-directory'], '取消上传-' + runId + '.bin');
    const sourceInfo = await digest(cancellableSource);
    const cancelled = await call('file_upload_prepare', {
      taskId,
      path: cancelPath,
      totalBytes: sourceInfo.bytes,
      sha256: sourceInfo.sha256,
      idempotencyKey: 'cancel-in-flight',
    });
    openTransfer = cancelled.transferId;
    const cancelReady = await settle(openTransfer, 'ready');
    const cancelContent = content(cancelReady, endpoint, 'PUT');
    const running = await curl(
      native,
      output,
      cancelContent,
      cancellableSource,
      join(output, 'cancel-reply.json'),
      262144
    );
    activeCurl.add(running);
    const began = Date.now();
    let observed;
    do {
      observed = await call('file_transfer_status', { transferId: openTransfer });
      if (observed.transferredBytes > 0 && observed.status === 'transferring') {
        break;
      }
      assert.ok(
        Date.now() - began < 15000 && !['completed', 'failed', 'unknown'].includes(observed.status),
        'Could not observe an in-flight upload.'
      );
      await delay(observed.pollAfterMs);
    } while (observed.transferredBytes === 0 || observed.status !== 'transferring');
    const terminal = await call('file_transfer_cancel', { transferId: openTransfer });
    await running.finished;
    activeCurl.delete(running);
    assert.equal(terminal.status, 'cancelled');
    assert.equal(terminal.destinationEffect, 'not_applied');
    const rejected = await fetch(cancelContent.url, {
      method: 'PUT',
      headers: cancelContent.headers,
      body: new Uint8Array(0),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(rejected.status, 409);
    await rejected.body?.cancel();
    const listing = await call('ls', { taskId, path: values['remote-directory'], limit: 100 });
    assert.ok(!listing.entries.some((entry) => entry.path === win32.basename(cancelPath)));
    report.cancellation = {
      observedBytes: observed.transferredBytes,
      status: terminal.status,
      destinationEffect: terminal.destinationEffect,
      targetAbsent: true,
      subsequentByteRequestStatus: rejected.status,
    };
    openTransfer = undefined;
    await call('task_end', { taskId });
    report.taskEnded = true;
    report.passed = true;
  } catch (error) {
    report.failure = { phase, type: error?.name ?? 'Error', code: error?.code ?? null };
    process.exitCode = 1;
  } finally {
    if (openTransfer && client) {
      await call('file_transfer_cancel', { transferId: openTransfer }).catch(() => {});
    }
    for (const active of activeCurl) {
      active.stop();
      await active.finished.catch(() => {});
    }
    if (taskId && !report.taskEnded) {
      report.cleanupTaskStopped = Boolean(await call('task_stop', { taskId }).catch(() => null));
    }
    if (client) {
      try {
        await client.close();
        report.sessionClosed = true;
      } catch {
        report.passed = false;
        report.failure ??= { phase: 'session-close', type: 'Error', code: null };
        process.exitCode = 1;
      }
    }
    report.completedAt = new Date().toISOString();
    const file = await open(join(output, 'report.json'), 'wx');
    try {
      await file.writeFile(JSON.stringify(report, null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    console.info(
      JSON.stringify({ passed: report.passed, report: join(output, 'report.json'), failure: report.failure })
    );
  }
}

await main().catch((error) => {
  console.error(
    JSON.stringify({
      initialized: false,
      type: error?.name,
      code: error?.code,
      frames: String(error?.stack ?? '')
        .split('\n')
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 3),
    })
  );
  process.exitCode = 1;
});
