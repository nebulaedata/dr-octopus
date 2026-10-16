/**
 * @author Codex
 * @description Provides actual in-memory MCP protocol responses for guarded Computer tests without capturing or operating the user's desktop.
 */
import { deflateSync, crc32 } from 'node:zlib';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { backendSchemas } from '../../src/runtime/computer/computer-inputs.ts';
import { WindowsMcpConnection } from '../../src/runtime/computer/windows-mcp-connection.ts';
import { ComputerUseActivity } from '../../src/runtime/computer/computer-use-activity.ts';
import { ComputerTools } from '../../src/runtime/computer/computer-tools.ts';

/**
 * Encodes a small deterministic, valid PNG; no screen pixels are acquired.
 */
export function fixturePng() {
  /**
   * Emits one CRC-checked PNG chunk.
   */
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(34))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

/**
 * Owns an exact linked MCP pair, a mutable response fixture and deterministic cleanup evidence.
 */
export async function computerFixture(run, options = {}) {
  const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'windows-mcp', version: 'fixture-guarded-1' });
  const identity = { hwnd: '123', pid: 123, processStartedAt: '123456' };
  const bounds = { left: -100, top: 20, width: 400, height: 200 };
  const meta = {
    contractVersion: 1,
    desktopSessionId: 'session-1',
    layoutVersion: 'layout-1',
    interactive: true,
    foreground: identity,
    displays: [{ index: 0, bounds }],
    windows: [{ identity, bounds, title: 'Owned deterministic fixture' }],
  };
  const state = {
    meta,
    capture: {
      contractVersion: 1,
      desktopSessionId: 'session-1',
      layoutVersion: 'layout-1',
      identity,
      captureRectPx: bounds,
      expectedBoundsPx: bounds,
      imageSizePx: { width: 4, height: 2 },
      image: { mimeType: 'image/png', data: fixturePng() },
    },
    result: { contractVersion: 1, effect: 'applied', code: 'OK' },
    calls: [],
    updates: [],
    stopped: 0,
    hold: undefined,
    responses: {},
  };
  for (const [name, schema] of Object.entries(backendSchemas)) {
    if (options.missing === name) {
      continue;
    }
    server.registerTool(name, { inputSchema: schema }, async (input) => {
      state.calls.push({ name, input });
      if (Object.hasOwn(state.responses, name)) {
        return structuredClone(state.responses[name]);
      }
      const response =
        name === 'ExecutorDesktopMeta'
          ? state.meta
          : name === 'ExecutorCapture'
            ? state.capture
            : state.result;
      if (state.hold && ['ExecutorInput', 'ExecutorFocusWindow'].includes(name)) {
        await state.hold;
      }
      return { content: [], structuredContent: structuredClone(response) };
    });
  }
  await server.connect(serverTransport);
  const connection = await WindowsMcpConnection.connect(
    { transport: 'stdio' },
    {
      openLocal: async () => ({
        transport,
        stop: async () => {
          state.stopped++;
        },
      }),
    }
  );
  const activity = new ComputerUseActivity(
    (update) => state.updates.push(update),
    options.confirmVisible ?? (async () => {})
  );
  const tools = new ComputerTools(activity, connection);
  try {
    await run({ tools, activity, state, connection });
  } finally {
    await tools.close();
    await server.close();
  }
}
