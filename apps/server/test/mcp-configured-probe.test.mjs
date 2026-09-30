/**
 * @author Codex
 * @description Checks real HTTP and stdio probe behavior against deterministic local MCP fixtures.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { McpConnectivityProbe } from '../dist/infrastructure/pi-mcp/connectivity-probe.js';

test('HTTP probe sends configured Bearer/header values without returning them', async () => {
  const requests = [];
  const http = createServer(async (req, res) => {
    requests.push(req.headers);
    if (req.headers.authorization !== 'Bearer probe-secret' || req.headers['x-key'] !== 'header-secret') {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (msg.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const result =
      msg.method === 'initialize'
        ? {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : { tools: [{ name: 'fixture_tool', inputSchema: { type: 'object' } }] };
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  try {
    const probe = new McpConnectivityProbe({ cwd: process.cwd() });
    const url = `http://127.0.0.1:${http.address().port}/mcp`;
    const result = await probe.probe('with-token', [
      {
        serverKey: 'fixture',
        entry: {
          url,
          httpTransport: 'streamable-http',
          auth: 'bearer',
          bearerToken: 'probe-secret',
          headers: { 'X-Key': 'header-secret' },
        },
      },
    ]);
    assert.deepEqual(result.servers, [{ serverKey: 'fixture', status: 'connected', toolCount: 1 }]);
    assert.ok(requests.length >= 2);
    assert.ok(!JSON.stringify(result).includes('secret'));
    const denied = await probe.probe('no-token', [{ serverKey: 'fixture', entry: { url } }]);
    assert.equal(denied.servers[0].status, 'needs_auth');
  } finally {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }
});

test('stdio probe honors environment inheritance and explicit overlays', async () => {
  const old = process.env.OCTOPUS_MCP_PROBE_SECRET;
  process.env.OCTOPUS_MCP_PROBE_SECRET = 'fixture-only';
  const code = `const readline=require('node:readline');
  readline.createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line); if(m.id===undefined)return;
    const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
      {tools:Array.from({length:process.env.OCTOPUS_MCP_PROBE_SECRET?2:1},(_,i)=>({name:'tool'+i,inputSchema:{type:'object'}}))};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
  });`;
  try {
    const probe = new McpConnectivityProbe({ cwd: process.cwd() });
    const target = { command: process.execPath, args: ['-e', code], inheritEnv: false };
    const isolated = await probe.probe('isolated', [{ serverKey: 'fixture', entry: target }]);
    assert.equal(isolated.servers[0].toolCount, 1);
    const inherited = await probe.probe('inherited', [
      { serverKey: 'fixture', entry: { ...target, inheritEnv: true } },
    ]);
    assert.equal(inherited.servers[0].toolCount, 2);
    const explicit = await probe.probe('explicit', [
      { serverKey: 'fixture', entry: { ...target, env: { OCTOPUS_MCP_PROBE_SECRET: 'explicit' } } },
    ]);
    assert.equal(explicit.servers[0].toolCount, 2);
  } finally {
    if (old === undefined) delete process.env.OCTOPUS_MCP_PROBE_SECRET;
    else process.env.OCTOPUS_MCP_PROBE_SECRET = old;
  }
});

test('probe identifies authentication requiring runtime facilities without attempting an external connection', async () => {
  const probe = new McpConnectivityProbe({ cwd: process.cwd() });
  for (const settings of [
    { auth: 'oauth' },
    { bearerTokenStore: true },
    { caFile: 'private.pem' },
    { requestHeadersCommand: { command: 'never-execute' } },
  ]) {
    const result = await probe.probe(JSON.stringify(settings), [
      { serverKey: 'fixture', entry: { url: 'https://never-connect.invalid', ...settings } },
    ]);
    assert.equal(result.servers[0].status, 'unsupported');
  }
});
