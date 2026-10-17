/**
 * @author Codex
 * @description Provides the real in-memory MCP protocol with pinned upstream schemas and controllable failures, without desktop access.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { windowsMcpSchemas } from '../../src/runtime/computer/windows-mcp-schemas.ts';
import { WindowsMcpConnection } from '../../src/runtime/computer/windows-mcp-connection.ts';
import { ComputerUseActivity } from '../../src/runtime/computer/computer-use-activity.ts';
import { ComputerTools } from '../../src/runtime/computer/computer-tools.ts';
export const fixturePng = () =>
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
/**
 * Creates one negotiated session and returns mutable fault controls; all owners are cleaned in finally.
 */
export async function computerFixture(run, options = {}) {
  const [transport, peer] = InMemoryTransport.createLinkedPair();
  const server = new Server(
    { name: 'windows-mcp', version: '4.0.5' },
    { capabilities: { tools: {}, logging: {} } }
  );
  const state = {
    calls: [],
    stopped: 0,
    control: { state: 'ready', generation: 1, wait_seconds: 0 },
    hold: undefined,
    result: undefined,
    cleanupFails: false,
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(windowsMcpSchemas)
      .map(([name, inputSchema]) => ({ name, inputSchema }))
      .filter((tool) => tool.name !== options.omit),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    state.calls.push(request.params);
    if (request.params.name === 'ControlStatus') {
      return {
        content: [{ type: 'text', text: JSON.stringify(state.control) }],
        structuredContent: state.control,
      };
    }
    if (state.hold) {
      await state.hold;
    }
    return (
      state.result ?? {
        content:
          request.params.name === 'Screenshot' || request.params.name === 'Snapshot'
            ? [
                { type: 'text', text: 'Physical origin 0,0; original 1x1; image 1x1' },
                { type: 'image', mimeType: 'image/png', data: fixturePng() },
              ]
            : [{ type: 'text', text: 'Done' }],
      }
    );
  });
  await server.connect(peer);
  let connection;
  try {
    connection = await WindowsMcpConnection.connect({
      transport,
      stop: async () => {
        state.stopped++;
        if (state.cleanupFails) {
          throw Error('cleanup failed');
        }
        await server.close();
      },
    });
    const activity = new ComputerUseActivity(() => {});
    const tools = new ComputerTools(activity, connection);
    await run({ connection, tools, activity, state, server });
    await tools.close();
  } finally {
    await connection?.close().catch(() => {});
    await server.close();
  }
}
