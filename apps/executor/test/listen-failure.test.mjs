/**
 * @author Codex
 * @description Verifies listener diagnostics, socket cleanup and actionable recovery guidance without user data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { HttpGateway } from '../src/runtime/mcp/http-gateway.ts';
import { RuntimeRecovery } from '../src/maintenance/runtime-recovery.ts';
import { explainListenFailure } from '../src/maintenance/listen-failure.ts';
import { runtimeMessageSchema } from '../src/contracts/runtime.ts';

for (const systemCode of ['EADDRNOTAVAIL', 'EADDRINUSE', 'EACCES', 'EPERM', 'ENOBUFS']) {
  test(`listener retains ${systemCode} and projects endpoint-specific recovery`, async () => {
    const gateway = new HttpGateway({ close: async () => {} });
    gateway.http.listen = () => {
      queueMicrotask(() =>
        gateway.http.emit('error', Object.assign(new Error('secret diagnostic'), { code: systemCode }))
      );
      return gateway.http;
    };
    try {
      await assert.rejects(gateway.listen(19876), (error) => {
        const diagnostic = { stage: 'mcp-listen', address: '127.0.0.1', port: 19876, systemCode };
        assert.deepEqual(error.diagnostic, diagnostic);
        assert.equal(error.code, systemCode === 'EADDRINUSE' ? 'PORT_IN_USE' : 'MCP_LISTEN_FAILED');
        const status = {
          state: 'failed',
          revision: 2,
          startupFailure: error.code,
          listenFailure: diagnostic,
          message: '执行服务初始化失败',
        };
        const recovery = new RuntimeRecovery({ readStatus: () => status }, {});
        const issue = recovery.read().issue;
        assert.equal(issue.recoverable, false);
        assert.match(issue.description, /127\.0\.0\.1:19876/);
        assert.match(issue.guidance, /设置 → 服务接入/);
        assert.match(issue.guidance, /重新启动应用/);
        assert.deepEqual(issue.listenFailure, diagnostic);
        assert.ok(!JSON.stringify(issue).includes('secret'));
        return true;
      });
      assert.equal(gateway.isListening(), false);
    } finally {
      await gateway.close();
    }
  });
}

test('real occupied endpoint reports EADDRINUSE and leaves the occupying listener intact', async () => {
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const gateway = new HttpGateway({ close: async () => {} });
  try {
    await assert.rejects(gateway.listen(occupied.address().port), (error) => {
      assert.equal(error.diagnostic.systemCode, 'EADDRINUSE');
      return true;
    });
    assert.equal(occupied.listening, true);
  } finally {
    await gateway.close();
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test('real unavailable network address reports the failed endpoint and closes loopback', async () => {
  const assigned = Object.values(networkInterfaces())
    .flat()
    .map((item) => item.address);
  const address = ['10.254.254.254', '192.168.254.254'].find((candidate) => !assigned.includes(candidate));
  assert.ok(address);
  const gateway = new HttpGateway({ close: async () => {} });
  let port;
  try {
    await assert.rejects(gateway.listen(0, address), (error) => {
      assert.equal(error.diagnostic.address, address);
      assert.equal(error.diagnostic.systemCode, 'EADDRNOTAVAIL');
      port = error.diagnostic.port;
      assert.ok(port > 0);
      const explanation = explainListenFailure(error.diagnostic);
      assert.match(explanation.guidance, /关闭「允许内网/);
      return true;
    });
    assert.equal(gateway.isListening(), false);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/mcp`));
  } finally {
    await gateway.close();
  }
});

test('startup diagnostics reject exception text and invalid endpoint fields', () => {
  const valid = {
    type: 'startup-failed',
    code: 'MCP_LISTEN_FAILED',
    listenFailure: { stage: 'mcp-listen', address: '192.168.0.78', port: 19876, systemCode: 'EADDRNOTAVAIL' },
  };
  assert.equal(runtimeMessageSchema.safeParse(valid).success, true);
  for (const patch of [
    { address: 'secret/path' },
    { port: 65536 },
    { systemCode: 'error with secret' },
    { message: 'secret' },
  ]) {
    assert.equal(
      runtimeMessageSchema.safeParse({ ...valid, listenFailure: { ...valid.listenFailure, ...patch } })
        .success,
      false
    );
  }
});
