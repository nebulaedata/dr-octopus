/**
 * @author Codex
 * @description Exercises real native binary transfers, task authority, temporary HTTP credentials and whole-file streams without an Agent bridge.
 */
import assert from 'node:assert/strict';
import { policyToolNameSchema } from '../../src/contracts/tool-policy.ts';
import test from 'node:test';
import { executorToolCatalog } from '../../src/runtime/mcp/mcp-server.ts';
import { mkdtemp, mkdir, writeFile, readFile, rm, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeFileCommit } from '../../src/runtime/basic/native-file-commit.ts';
import { FilePublication } from '../../src/runtime/basic/file-publication.ts';
import { BasicTools } from '../../src/runtime/basic/basic-tools.ts';
import { ControlStore } from '../../src/runtime/mcp/control-store.ts';
import { TaskAuthority } from '../../src/runtime/mcp/task-authority.ts';
import { HttpGateway } from '../../src/runtime/mcp/http-gateway.ts';
import { TransferStore } from '../../src/runtime/transfer/transfer-store.ts';
import { TransferFiles } from '../../src/runtime/transfer/transfer-files.ts';
import { TransferService } from '../../src/runtime/transfer/transfer-service.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Readable, PassThrough } from 'node:stream';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFile);

/**
 * Builds one isolated production Runtime and always drains it before deleting owned fixtures.
 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'octopus-transfer-test-'));
  const native = new NativeFileCommit(
    fileURLToPath(new URL('../../dist/native/file-commit.node', import.meta.url))
  );
  const userData = join(root, 'runtime');
  const workspace = join(root, 'workspace');
  await mkdir(userData);
  await mkdir(workspace);
  const publication = await FilePublication.open(native, userData);
  const basic = new BasicTools(publication);
  const controls = await ControlStore.open(native, userData);
  const authority = new TaskAuthority(basic, controls);
  const store = await TransferStore.open(native, userData);
  const transfers = new TransferService(store, new TransferFiles(native, store.root), (...args) =>
    authority.transferContext(...args)
  );
  await authority.attachTransfers(transfers);
  authority.setToolPolicy(policyToolNameSchema.options, 0);
  const gateway = new HttpGateway(authority);
  const endpoint = await gateway.listen(0);
  const { grant, token } = await authority.approve({
    label: 'transfer-test',
    permissions: ['files.write'],
    waitBudgetMs: 600000,
  });
  const task = await authority.start(grant.clientId, {
    capabilities: ['files.write'],
    cwd: workspace,
    idempotencyKey: 'task',
  });
  try {
    await run({
      root,
      native,
      authority,
      controls,
      store,
      transfers,
      gateway,
      endpoint,
      token,
      owner: grant.clientId,
      taskId: task.taskId,
      workspace,
    });
  } finally {
    await gateway.close();
    await basic.close();
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Waits with a finite test deadline without inferring completion from an idle network connection.
 */
async function settle(read, desired = 'ready', attempts = 600) {
  for (let i = 0; i < attempts; i++) {
    const result = await read();
    if (result.status === desired) {
      return result;
    }
    if (['failed', 'unknown', 'cancelled', 'expired'].includes(result.status)) {
      assert.fail(JSON.stringify(result));
    }
    await delay(Math.min(result.pollAfterMs ?? 20, 1000));
  }
  assert.fail('Transfer did not reach expected state');
}

/**
 * Connects an ordinary external MCP client directly to the real Executor listener.
 */
async function withMcp(f, run, token = f.token) {
  const client = new Client({ name: 'external-agent-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(f.endpoint), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } },
    })
  );
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

/**
 * Extracts only metadata from the normal tools/call result and keeps failures explicit.
 */
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent.data;
}

/**
 * Polls asynchronous preparation through MCP, then returns its scoped HTTP instructions.
 */
async function prepare(f, client, path, size, key, digest) {
  const input = { taskId: f.taskId, path, idempotencyKey: key };
  const name = size === undefined ? 'file_download_prepare' : 'file_upload_prepare';
  if (size !== undefined) {
    input.totalBytes = size;
  }
  if (digest !== undefined) {
    input.sha256 = digest;
  }
  const initial = await call(client, name, input);
  return settle(() => call(client, 'file_transfer_status', { transferId: initial.transferId }));
}

/**
 * Uses the OS HTTP utility exactly as an external Agent could, without returning source bytes to a model.
 */
async function curl(content, args) {
  const result = await runFile(
    'curl.exe',
    [
      '--silent',
      '--show-error',
      '--fail',
      '--max-time',
      '180',
      '--header',
      'Authorization: ' + content.headers.Authorization,
      ...args,
      content.url,
    ],
    { windowsHide: true, maxBuffer: 65536 }
  );
  return result.stdout;
}

test('direct MCP discovery exposes four transfer tools and capability prerequisites', async () =>
  fixture(async (f) =>
    withMcp(f, async (client) => {
      const tools = (await client.listTools()).tools;
      const transfer = tools.filter((tool) => tool.name.startsWith('file_'));
      assert.deepEqual(transfer.map((tool) => tool.name).sort(), executorToolCatalog(true).transfer.sort());
      assert.equal(transfer.length, 4);
      assert.equal(
        tools.some((tool) => tool.name === 'transfer_create' || tool.name === 'executor_upload_file'),
        false
      );
      assert.match(
        transfer.find((tool) => tool.name === 'file_upload_prepare').description,
        /otherwise do not call/
      );
      assert.match(
        transfer.find((tool) => tool.name === 'file_download_prepare').description,
        /saves binary responses directly/
      );
      assert.ok(tools.some((tool) => tool.name === 'read'));
      const readOnly = await f.authority.approve({
        label: 'read-only',
        permissions: ['files.read'],
        waitBudgetMs: 60000,
      });
      await withMcp(
        f,
        async (reader) => {
          const names = (await reader.listTools()).tools.map((tool) => tool.name);
          assert.ok(names.includes('file_download_prepare'));
          assert.equal(names.includes('file_upload_prepare'), false);
        },
        readOnly.token
      );
    })
  ));

test('OS curl uploads and downloads empty and multi-MiB binary files through direct MCP metadata', async () =>
  fixture(async (f) =>
    withMcp(f, async (client) => {
      for (const [index, bytes] of [Buffer.alloc(0), Buffer.alloc(8 * 1024 ** 2 + 37, 0xa7)].entries()) {
        const source = join(f.root, '源 file-' + index + '.zip');
        const target = join(f.workspace, 'remote-' + index + '.zip');
        const local = join(f.root, 'received-' + index + '.zip');
        const digest = createHash('sha256').update(bytes).digest('hex');
        await writeFile(source, bytes);
        const upload = await prepare(f, client, target, bytes.length, 'up-' + index, digest);
        assert.equal(upload.content.method, 'PUT');
        assert.equal(upload.content.headers.Authorization.includes(f.token), false);
        const reply = await curl(upload.content, ['--upload-file', source]);
        assert.equal(JSON.parse(reply).status, 'completed');
        const completed = await call(client, 'file_transfer_status', { transferId: upload.transferId });
        assert.equal(completed.status, 'completed');
        assert.equal(completed.sha256, digest);
        assert.equal(completed.content, undefined);
        assert.deepEqual(await readFile(target), bytes);
        const download = await prepare(f, client, target, undefined, 'down-' + index);
        assert.equal(download.content.method, 'GET');
        await curl(download.content, ['--output', local]);
        await settle(
          () => call(client, 'file_transfer_status', { transferId: download.transferId }),
          'completed'
        );
        assert.deepEqual(await readFile(local), bytes);
        assert.equal(download.sha256, digest);
        const journal = await readFile(join(f.store.root, 'events.jsonl'), 'utf8');
        assert.equal(journal.includes(upload.content.headers.Authorization.slice(7)), false);
      }
    })
  ));

test('temporary byte credentials reject device Bearer, wrong transfer, listener, method and MCP use', async () =>
  fixture(async (f) =>
    withMcp(f, async (client) => {
      const upload = await prepare(f, client, join(f.workspace, 'secure.bin'), 1, 'secure');
      const headers = upload.content.headers;
      assert.equal(
        (
          await fetch(upload.content.url, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + f.token },
            body: 'x',
          })
        ).status,
        401
      );
      assert.equal((await fetch(upload.content.url)).status, 401);
      assert.equal((await fetch(upload.content.url, { headers })).status, 409);
      const other = upload.content.url.replace(upload.transferId, randomUUID());
      assert.equal((await fetch(other, { method: 'PUT', headers, body: 'x' })).status, 401);
      assert.throws(
        () =>
          f.transfers.authenticate(
            upload.transferId,
            headers.Authorization.slice(7),
            'http://192.168.1.9:8787',
            'PUT'
          ),
        /credential/
      );
      assert.equal((await fetch(f.endpoint, { method: 'POST', headers, body: '{}' })).status, 401);
      assert.equal(
        (
          await fetch(upload.content.url, {
            method: 'PUT',
            headers: { ...headers, Origin: 'http://foreign.example' },
            body: 'x',
          })
        ).status,
        403
      );
      const badLength = await fetch(upload.content.url, { method: 'PUT', headers, body: 'xx' });
      assert.equal(badLength.status, 400);
      assert.equal(
        (await call(client, 'file_transfer_status', { transferId: upload.transferId })).status,
        'ready'
      );
      await f.authority.revoke(f.owner);
      assert.equal((await fetch(upload.content.url, { method: 'PUT', headers, body: 'x' })).status, 401);
      await assert.rejects(stat(join(f.workspace, 'secure.bin')), { code: 'ENOENT' });
    })
  ));

test('preparation is idempotent and blocks other mutations; lost upload replies are queried, not replayed', async () =>
  fixture(async (f) => {
    const path = join(f.workspace, 'result.xlsx');
    const request = { taskId: f.taskId, path, totalBytes: 4, idempotencyKey: 'upload' };
    const initial = await f.authority.transferControl(f.owner, 'file_upload_prepare', request);
    await settle(() =>
      f.transfers.control(f.owner, 'file_transfer_status', { transferId: initial.transferId })
    );
    assert.equal(
      (await f.authority.transferControl(f.owner, 'file_upload_prepare', request)).transferId,
      initial.transferId
    );
    await assert.rejects(
      f.authority.transferControl(f.owner, 'file_upload_prepare', { ...request, path: path + 'x' }),
      /different tool input/
    );
    await assert.rejects(f.authority.end(f.owner, f.taskId), /progress/);
    await assert.rejects(
      f.authority.call(
        f.owner,
        'write',
        { taskId: f.taskId, path: 'other.txt', content: 'x', idempotencyKey: 'other' },
        new AbortController().signal
      ),
      /progress/
    );
    await assert.rejects(
      f.transfers.control(randomUUID(), 'file_transfer_status', { transferId: initial.transferId }),
      /unavailable/
    );
    const bytes = Buffer.from([0, 255, 16, 32]);
    await f.transfers.upload(f.owner, initial.transferId, Readable.from([bytes]), bytes.length);
    const result = await f.transfers.control(f.owner, 'file_transfer_status', {
      transferId: initial.transferId,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.destinationEffect, 'applied');
    assert.equal(result.cleanupPending, false);
    assert.deepEqual(await readFile(path), bytes);
    await assert.rejects(
      f.transfers.upload(f.owner, initial.transferId, Readable.from([bytes]), bytes.length),
      /no longer accepts/
    );
    await assert.rejects(
      f.authority.call(
        f.owner,
        'write',
        { taskId: f.taskId, path: 'x', content: 'x', idempotencyKey: 'upload' },
        new AbortController().signal
      ),
      /different tool input/
    );
  }));

test('racing target creation and expected checksum mismatch never overwrite or publish corrupt data', async () =>
  fixture(async (f) => {
    const bytes = Buffer.from('payload');
    for (const kind of ['race', 'checksum']) {
      const path = join(f.workspace, kind + '.bin');
      const initial = await f.transfers.control(f.owner, 'file_upload_prepare', {
        taskId: f.taskId,
        path,
        totalBytes: bytes.length,
        idempotencyKey: kind,
        ...(kind === 'checksum' ? { sha256: '0'.repeat(64) } : {}),
      });
      await settle(() =>
        f.transfers.control(f.owner, 'file_transfer_status', { transferId: initial.transferId })
      );
      if (kind === 'race') {
        await writeFile(path, 'competitor');
      }
      if (kind === 'checksum') {
        await assert.rejects(
          f.transfers.upload(f.owner, initial.transferId, Readable.from([bytes]), bytes.length),
          /checksum/
        );
        await assert.rejects(stat(path), { code: 'ENOENT' });
      } else {
        const result = await f.transfers.upload(
          f.owner,
          initial.transferId,
          Readable.from([bytes]),
          bytes.length
        );
        assert.equal(result.status, 'failed');
        assert.equal(result.destinationEffect, 'not_applied');
        assert.equal(await readFile(path, 'utf8'), 'competitor');
      }
    }
  }));

test('task stop aborts a real incomplete HTTP body and drains bytes without waiting for task expiry', async () =>
  fixture(async (f) =>
    withMcp(f, async (client) => {
      const upload = await prepare(f, client, join(f.workspace, 'cancelled.bin'), 1024, 'cancel');
      const request = httpRequest(upload.content.url, {
        method: 'PUT',
        headers: { ...upload.content.headers, 'Content-Length': '1024' },
      });
      request.on('error', () => {});
      request.write(Buffer.alloc(8));
      await settle(
        () => call(client, 'file_transfer_status', { transferId: upload.transferId }),
        'transferring'
      );
      await f.authority.stop(f.owner, f.taskId);
      request.destroy();
      const stopped = await f.transfers.control(f.owner, 'file_transfer_status', {
        transferId: upload.transferId,
      });
      assert.equal(stopped.status, 'cancelled');
      assert.equal(stopped.cleanupPending, false);
      assert.equal(f.transfers.working(f.taskId), false);
      await assert.rejects(stat(join(f.workspace, 'cancelled.bin')), { code: 'ENOENT' });
    })
  ));

test('truncated bodies fail and expired transfer capabilities never admit file bytes', async () =>
  fixture(async (f) => {
    const initial = await f.transfers.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path: join(f.workspace, 'short.bin'),
      totalBytes: 10,
      idempotencyKey: 'short',
    });
    await settle(() =>
      f.transfers.control(f.owner, 'file_transfer_status', { transferId: initial.transferId })
    );
    await assert.rejects(
      f.transfers.upload(f.owner, initial.transferId, Readable.from([Buffer.alloc(2)]), 10),
      /truncated/
    );
    const failed = await f.transfers.control(f.owner, 'file_transfer_status', {
      transferId: initial.transferId,
    });
    assert.equal(failed.status, 'failed');
    const next = await f.transfers.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path: join(f.workspace, 'expired.bin'),
      totalBytes: 1,
      idempotencyKey: 'expired',
    });
    await settle(() => f.transfers.control(f.owner, 'file_transfer_status', { transferId: next.transferId }));
    const record = f.store.records.get(next.transferId);
    const origin = new URL(f.endpoint).origin;
    const token = f.transfers.content(f.owner, next.transferId, origin).headers.Authorization.slice(7);
    record.expiresAt = Date.now() - 1;
    assert.throws(() => f.transfers.authenticate(next.transferId, token, origin, 'PUT'));
    await f.transfers.control(f.owner, 'file_transfer_cancel', { transferId: next.transferId });
  }));

test('a transfer deadline aborts an idle source and records expired without publication', async () =>
  fixture(async (f) => {
    const initial = await f.transfers.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path: join(f.workspace, 'deadline.bin'),
      totalBytes: 100,
      idempotencyKey: 'deadline',
    });
    await settle(() =>
      f.transfers.control(f.owner, 'file_transfer_status', { transferId: initial.transferId })
    );
    f.store.records.get(initial.transferId).expiresAt = Date.now() + 100;
    const source = new PassThrough();
    await assert.rejects(f.transfers.upload(f.owner, initial.transferId, source, 100));
    const expired = await f.transfers.control(f.owner, 'file_transfer_status', {
      transferId: initial.transferId,
    });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.cleanupPending, false);
    assert.equal(source.destroyed, true);
    await assert.rejects(stat(initial.path), { code: 'ENOENT' });
  }));

test('download cancellation drains backpressure without claiming Agent-local publication', async () =>
  fixture(async (f) =>
    withMcp(f, async (client) => {
      const path = join(f.workspace, 'cancel-download.bin');
      await writeFile(path, Buffer.alloc(8 * 1024 ** 2, 0x6b));
      const download = await prepare(f, client, path, undefined, 'cancel-download');
      const destination = new PassThrough({ highWaterMark: 1 });
      const sending = f.transfers.download(f.owner, download.transferId, destination);
      const observed = assert.rejects(sending);
      await settle(
        () => f.transfers.control(f.owner, 'file_transfer_status', { transferId: download.transferId }),
        'transferring'
      );
      const result = await f.transfers.control(f.owner, 'file_transfer_cancel', {
        transferId: download.transferId,
      });
      await observed;
      assert.equal(result.status, 'cancelled');
      assert.equal(result.destinationEffect, 'not_applied');
      assert.equal(result.cleanupPending, false);
      assert.equal(destination.destroyed, true);
      assert.equal((await stat(path)).size, 8 * 1024 ** 2);
    })
  ));

test('interruptions recover results without resuming bytes or restoring old temporary credentials', async () =>
  fixture(async (f) => {
    const initial = await f.transfers.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path: join(f.workspace, 'restart.bin'),
      totalBytes: 3,
      idempotencyKey: 'restart',
    });
    await settle(() =>
      f.transfers.control(f.owner, 'file_transfer_status', { transferId: initial.transferId })
    );
    const origin = new URL(f.endpoint).origin;
    const token = f.transfers.content(f.owner, initial.transferId, origin).headers.Authorization.slice(7);
    const restored = await TransferStore.open(f.native, join(f.root, 'runtime'));
    const recovered = new TransferService(restored, new TransferFiles(f.native, restored.root), (...args) =>
      f.authority.transferContext(...args)
    );
    assert.throws(() => recovered.authenticate(initial.transferId, token, origin, 'PUT'), /credential/);
    await recovered.recover();
    const result = await recovered.control(f.owner, 'file_transfer_status', {
      transferId: initial.transferId,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'PROCESS_INTERRUPTED');
    assert.equal(result.cleanupPending, false);
  }));
test('native transfer snapshot is binary, private, bounded, and refuses sources opened for writing', async () =>
  fixture(async ({ native, workspace }) => {
    const source = join(workspace, '中文 document.bin');
    const bytes = Buffer.from([0, 255, 1, 2, 0, 129]);
    await writeFile(source, bytes);
    const directory = join(workspace, '.octopus-executor-recovery-native-transfer');
    assert.equal((await native.createRecovery(directory)).ok, true);
    const destination = join(directory, 'snapshot');
    const writer = await open(source, 'r+');
    try {
      assert.equal((await native.transferSnapshot(source, destination, bytes.length)).ok, false);
    } finally {
      await writer.close();
    }
    const result = await native.transferSnapshot(source, destination, bytes.length);
    assert.equal(result.ok, true);
    assert.equal(result.digest, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await readFile(destination), bytes);
    assert.equal((await native.transferDigest(destination, bytes.length)).digest, result.digest);
    await assert.rejects(native.transferDigest(destination, 2 * 1024 ** 3 + 1));
  }));

test(
  '2 GiB source boundary is streamed into a native snapshot, while one extra byte is refused',
  { timeout: 180000 },
  async () =>
    fixture(async ({ native, workspace }) => {
      const path = join(workspace, 'large.bin');
      const size = 2 * 1024 ** 3;
      const file = await open(path, 'wx');
      try {
        await file.truncate(size);
      } finally {
        await file.close();
      }
      const directory = join(workspace, '.octopus-executor-recovery-large-transfer');
      assert.equal((await native.createRecovery(directory)).ok, true);
      const before = process.memoryUsage().arrayBuffers;
      const snapshot = await native.transferSnapshot(path, join(directory, 'content'), size);
      assert.equal(snapshot.ok, true);
      assert.equal(snapshot.size, size);
      const digest = await native.transferDigest(join(directory, 'content'), size);
      assert.equal(digest.digest, snapshot.digest);
      assert.ok(
        process.memoryUsage().arrayBuffers - before < 64 * 1024 ** 2,
        'native streaming must not materialize a 2 GiB JS buffer'
      );
      await assert.rejects(native.transferSnapshot(path, join(directory, 'oversize'), size + 1));
    })
);

test('publication recovery verifies an uncertain commit without repeating the native mutation', async () =>
  fixture(async (f) => {
    const home = join(f.root, 'isolated-publication');
    await mkdir(home);
    const store = await TransferStore.open(f.native, home);
    const files = new TransferFiles(f.native, store.root);
    const service = new TransferService(store, files, (...args) => f.authority.transferContext(...args));
    const path = join(f.workspace, 'uncertain.bin');
    const bytes = Buffer.from([0, 255, 5, 0]);
    const result = await service.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path,
      totalBytes: bytes.length,
      idempotencyKey: 'uncertain',
    });
    await settle(() => service.control(f.owner, 'file_transfer_status', { transferId: result.transferId }));
    const publish = files.publish.bind(files);
    let commits = 0;
    files.publish = async (...args) => {
      commits++;
      await publish(...args);
      throw new Error('Simulated lost native completion');
    };
    await assert.rejects(
      service.upload(f.owner, result.transferId, Readable.from([bytes]), bytes.length),
      /lost native completion/
    );
    assert.equal(
      (await service.control(f.owner, 'file_transfer_status', { transferId: result.transferId })).status,
      'unknown'
    );
    assert.deepEqual(await readFile(path), bytes);
    const restored = await TransferStore.open(f.native, home);
    const recovered = new TransferService(restored, files, (...args) => f.authority.transferContext(...args));
    await recovered.recover();
    const confirmed = await recovered.control(f.owner, 'file_transfer_status', {
      transferId: result.transferId,
    });
    assert.equal(confirmed.status, 'completed');
    assert.equal(confirmed.destinationEffect, 'applied');
    assert.equal(commits, 1);
  }));

test('disk admission failure leaves no target and releases only allocated quota', async () =>
  fixture(async (f) => {
    const home = join(f.root, 'disk-admission');
    await mkdir(home);
    const store = await TransferStore.open(f.native, home);
    const files = new TransferFiles(f.native, store.root);
    files.capacity = async () => {
      throw new Error('Simulated full volume');
    };
    const service = new TransferService(store, files, (...args) => f.authority.transferContext(...args));
    const path = join(f.workspace, 'no-space.bin');
    const result = await service.control(f.owner, 'file_upload_prepare', {
      taskId: f.taskId,
      path,
      totalBytes: 1024,
      idempotencyKey: 'disk-full',
    });
    for (let attempt = 0; attempt < 200 && service.working(f.taskId); attempt++) {
      await delay(10);
    }
    const failure = await service.control(f.owner, 'file_transfer_status', { transferId: result.transferId });
    assert.equal(failure.status, 'failed');
    assert.equal(failure.destinationEffect, 'not_applied');
    assert.equal(failure.cleanupPending, false);
    assert.equal(store.records.get(result.transferId).reservedBytes, 0);
    await assert.rejects(stat(path), { code: 'ENOENT' });
  }));

test(
  '2 GiB curl round trip preserves native checksums with bounded JavaScript buffers',
  { timeout: 360000 },
  async (t) =>
    fixture(async (f) =>
      withMcp(f, async (client) => {
        const source = join(f.root, 'large-source.bin');
        const target = join(f.workspace, 'large-target.bin');
        const destination = join(f.root, 'large-result.bin');
        const size = 2 * 1024 ** 3;
        const file = await open(source, 'wx');
        try {
          await file.truncate(size);
        } finally {
          await file.close();
        }
        const expected = await f.native.transferDigest(source, size);
        const baseline = process.memoryUsage().arrayBuffers;
        let peak = baseline;
        const sampler = setInterval(() => {
          peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        }, 10);
        try {
          const startedAt = Date.now();
          const up = await prepare(f, client, target, size, 'large-up', expected.digest);
          assert.equal(JSON.parse(await curl(up.content, ['--upload-file', source])).status, 'completed');
          t.diagnostic(
            '2 GiB upload including verification/publication: ' + (Date.now() - startedAt) + ' ms'
          );
          const snapshotAt = Date.now();
          const down = await prepare(f, client, target, undefined, 'large-down');
          t.diagnostic('2 GiB download snapshot preparation: ' + (Date.now() - snapshotAt) + ' ms');
          await curl(down.content, ['--output', destination]);
          await settle(
            () => call(client, 'file_transfer_status', { transferId: down.transferId }),
            'completed'
          );
          assert.equal((await f.native.transferDigest(destination, size)).digest, expected.digest);
          t.diagnostic('Peak JavaScript buffer increase: ' + (peak - baseline) + ' bytes');
          assert.ok(peak - baseline < 128 * 1024 ** 2, '2 GiB files must not become whole-file JS buffers');
        } finally {
          clearInterval(sampler);
        }
      })
    )
);
