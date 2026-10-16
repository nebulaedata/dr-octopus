/**
 * @author Codex
 * @description Serves deterministic MCP discovery over stdio without importing or operating a Windows desktop backend.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'windows-mcp', version: '0.8.6' });
server.registerTool('ExecutorDesktopMeta', { inputSchema: {} }, async () => ({ content: [] }));
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => {
  void server.close().finally(() => process.exit(0));
});
