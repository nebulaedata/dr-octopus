/**
 * @author Codex
 * @description Official MCP client with version negotiation and strict Dr.Octopus application contracts.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { knowledgeMcpSchemas } from '@octopus/shared/protocol/knowledge';
import { boundedKnowledgeFetch } from '../bounded-fetch.js';
import { KnowledgeError } from '../../definitions/error.js';
import type { KnowledgeMcpTool } from '@octopus/shared/protocol/knowledge';

export class RemoteKnowledgeClient {
  private readonly client = new Client(
    { name: 'dr-octopus-knowledge', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } }
  );
  /**
   * Bind an immutable resolved connection and total deadline for this short-lived operation.
   */
  constructor(
    private readonly connection: { url: string; headers: Record<string, string> },
    private readonly signal: AbortSignal
  ) {}

  /**
   * Connect without OAuth or stdio, and check all required declared tool contracts.
   */
  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(this.connection.url), {
      requestInit: { headers: this.connection.headers },
      fetch: async (url, init) => {
        const signal = AbortSignal.any([this.signal, ...(init?.signal ? [init.signal] : [])]);
        const response = await boundedKnowledgeFetch(url, { ...init, signal });
        if ([401, 403].includes(response.status)) {
          throw new KnowledgeError('AUTH_REQUIRED', '远端知识库令牌无效');
        }
        return response;
      },
    });
    await this.client.connect(transport, { signal: this.signal, timeout: 5000 });
    const listing = await this.client.listTools({}, { signal: this.signal, timeout: 5000 });
    for (const name of Object.keys(knowledgeMcpSchemas)) {
      const tool = listing.tools.find((item) => item.name === name);
      if (!tool || tool.inputSchema.type !== 'object' || !tool.outputSchema) {
        throw new KnowledgeError('INCOMPATIBLE', '远端缺少知识库工具契约');
      }
    }
  }

  /**
   * Validate both sides of the application contract; raw provider text never becomes a local trusted DTO.
   */
  async call<K extends KnowledgeMcpTool>(name: K, input: unknown) {
    const args = knowledgeMcpSchemas[name].input.parse(input);
    const result = await this.client.callTool(
      { name, arguments: args },
      { signal: this.signal, timeout: 5000 }
    );
    if (result.isError) {
      const raw = result.structuredContent as { code?: unknown } | undefined;
      const code =
        typeof raw?.code === 'string' &&
        [
          'AUTH_REQUIRED',
          'FORBIDDEN',
          'NOT_FOUND',
          'REVISION_EXPIRED',
          'RATE_LIMITED',
          'UNAVAILABLE',
        ].includes(raw.code)
          ? raw.code
          : 'UNAVAILABLE';
      throw new KnowledgeError(code, '远端知识库调用失败', code === 'UNAVAILABLE' || code === 'RATE_LIMITED');
    }
    let value: unknown = result.structuredContent;
    if (value === undefined) {
      const text = result.content.find((item) => item.type === 'text');
      try {
        value = text?.type === 'text' ? JSON.parse(text.text) : undefined;
      } catch {
        value = undefined;
      }
    }
    const parsed = knowledgeMcpSchemas[name].output.safeParse(value);
    if (!parsed.success) {
      throw new KnowledgeError('INCOMPATIBLE', '远端知识库返回的协议内容无效');
    }
    return parsed.data as ReturnType<(typeof knowledgeMcpSchemas)[K]['output']['parse']>;
  }

  /**
   * Release only this operation's transport; ordinary Agent MCP runtimes are not involved.
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}
