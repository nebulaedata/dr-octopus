/**
 * @author Codex
 * @description Runs a finite read-only MCP acceptance probe using an explicitly supplied private HTTP configuration; reports evidence without credentials or file contents.
 */
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { networkAddressSchema } from '../../build/tooling/application-api.mjs';
const configSchema = z.object({
  protocolVersion: z.literal('2025-11-25'),
  mcpServers: z.object({
    'octopus-executor': z.strictObject({
      url: z.string().max(256),
      headers: z.strictObject({ Authorization: z.string().regex(/^Bearer [a-f0-9]{64}$/) }),
    }),
  }),
});
const checks = {};
let phase = 'arguments';
let sessionClosed = false;
let taskEndConfirmed = false;
/**
 * Bounds every response, disallows redirects, and preserves SDK cancellation with a ten-second network deadline.
 */
async function boundedFetch(input, init) {
  const signals = [AbortSignal.timeout(10000)];
  if (init?.signal) {
    signals.push(init.signal);
  }
  const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) });
  const reader = response.body?.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (reader) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      length += next.value.byteLength;
      if (length > 2 * 1024 * 1024) {
        throw new Error('Response limit exceeded.');
      }
      chunks.push(next.value);
    }
  } finally {
    await reader?.cancel();
  }
  const body = [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks);
  return new Response(body, { status: response.status, headers: response.headers });
}
/**
 * Performs only authentication probes, one files.read task, and session cleanup; never starts an Executor or replays a call.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      report: { type: 'string' },
      'fixture-path': { type: 'string' },
      'expected-sha256': { type: 'string' },
    },
  });
  const options = z
    .object({
      config: z.string().min(1),
      report: z.string().min(1),
      'fixture-path': z
        .string()
        .max(4096)
        .regex(/^[A-Za-z]:\\.+\.txt$/i),
      'expected-sha256': z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(values);
  // Reserve evidence before reading credentials or making requests. Never overwrite a prior report.
  const reportFile = await open(options.report, 'wx', 0o600);
  let client;
  let transport;
  let taskId;
  let endpoint;
  let targetIsLocalInterface;
  let passed = false;
  try {
    phase = 'configuration';
    const file = await open(options.config, constants.O_RDONLY | constants.O_NOFOLLOW);
    let configuration;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 16384) {
        throw new Error('Invalid configuration size.');
      }
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) {
        throw new Error('Configuration grew beyond its limit.');
      }
      configuration = configSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
    } finally {
      await file.close();
    }
    const server = configuration.mcpServers['octopus-executor'];
    const url = new URL(server.url);
    networkAddressSchema.parse(url.hostname);
    if (
      url.protocol !== 'http:' ||
      url.pathname !== '/mcp' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error('Only an explicit private HTTP MCP endpoint is supported.');
    }
    endpoint = url.href;
    targetIsLocalInterface = Object.values(networkInterfaces())
      .flat()
      .some((item) => item?.address === url.hostname);
    phase = 'unauthenticated-rejection';
    checks.noCredentialRejected = (await boundedFetch(url)).status === 401;
    checks.wrongCredentialRejected =
      (
        await boundedFetch(url, {
          headers: { Authorization: 'Bearer ' + randomUUID().replaceAll('-', '').repeat(2) },
        })
      ).status === 401;
    phase = 'bridge-isolation';
    const bridge = new URL('/browser-bridge', url);
    checks.bridgeUnavailable =
      (await boundedFetch(bridge, { method: 'POST', headers: server.headers, body: '{}' })).status === 404;
    phase = 'handshake';
    client = new Client({ name: 'executor-network-acceptance-probe', version: '0.0.1' });
    transport = new StreamableHTTPClientTransport(url, {
      fetch: boundedFetch,
      requestInit: { headers: server.headers },
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    await client.connect(transport, { timeout: 15000 });
    checks.handshake = !!transport.sessionId;
    phase = 'tool-discovery';
    const listing = await client.listTools({}, { timeout: 15000 });
    checks.readToolListed = listing.tools.some((tool) => tool.name === 'read');
    checks.computerNotExposed = listing.tools.every((tool) => !tool.name.startsWith('computer_'));
    phase = 'task-start';
    const start = await client.callTool(
      {
        name: 'task_start',
        arguments: {
          capabilities: ['files.read'],
          idempotencyKey: 'network-probe-' + randomUUID(),
        },
      },
      undefined,
      { timeout: 15000 }
    );
    if (start.isError) {
      throw new Error('Read-only task refused.');
    }
    taskId = z
      .object({ data: z.object({ taskId: z.string().min(1).max(128) }) })
      .parse(start.structuredContent).data.taskId;
    phase = 'fixture-read';
    const read = await client.callTool(
      { name: 'read', arguments: { taskId, path: options['fixture-path'], byteLimit: 4096 } },
      undefined,
      { timeout: 15000 }
    );
    if (read.isError) {
      throw new Error('Fixture read refused.');
    }
    const data = z
      .object({ data: z.object({ text: z.string(), truncated: z.literal(false) }) })
      .parse(read.structuredContent).data;
    checks.fixtureDigestMatches =
      createHash('sha256').update(data.text, 'utf8').digest('hex') === options['expected-sha256'];
    passed = Object.values(checks).every(Boolean);
  } catch {
    // Infrastructure and server errors may contain paths, contents or headers; report only the owning phase.
    passed = false;
  } finally {
    if (client && taskId) {
      try {
        const end = await client.callTool({ name: 'task_end', arguments: { taskId } }, undefined, {
          timeout: 15000,
        });
        taskEndConfirmed = end.isError !== true;
      } catch {
        taskEndConfirmed = false;
      }
    }
    if (transport?.sessionId) {
      try {
        await transport.terminateSession();
        sessionClosed = true;
      } catch {
        sessionClosed = false;
      }
    }
    await client?.close().catch(() => undefined);
    passed = passed && taskEndConfirmed && sessionClosed;
    await reportFile.writeFile(
      JSON.stringify(
        {
          schemaVersion: 1,
          recordedAtUtc: new Date().toISOString(),
          scope: 'generic-mcp-read-only-network-probe',
          passed,
          phase,
          endpoint,
          targetIsLocalInterface,
          checks,
          taskEndConfirmed,
          sessionClosed,
          taskId,
          taskStartOutcomeUnknown: !taskId && phase === 'task-start',
          acceptance: { G4: 'pending', G5: 'pending', G6: 'pending' },
          actualAgentClientCompatibility: 'not-tested',
          crossComputerEvidence: 'manual-environment-record-required',
        },
        null,
        2
      )
    );
    await reportFile.close();
    process.stdout.write(
      `Network probe ${passed ? 'passed' : 'failed'}. See the private evidence report; acceptance gates remain pending.\n`
    );
    process.exitCode = passed ? 0 : 1;
  }
}
void main().catch(() => {
  process.stderr.write(
    'Probe could not reserve evidence or validate arguments. No error details are printed.\n'
  );
  process.exitCode = 1;
});
