/**
 * @author Codex
 * @description Forwards one bounded stdio protocol session to the existing authenticated Runtime without reconnecting or replaying requests.
 */
import type { Readable, Writable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isInitializeRequest, isInitializedNotification } from '@modelcontextprotocol/sdk/types.js';
import { readStdioMessages, StdioWriter, stdioFrameLimit } from './stdio-framing';

/**
 * Preserves streaming while refusing invalid UTF-8 and oversized JSON bodies or SSE events before SDK buffering.
 */
function boundedResponse(response: Response): Response {
  if (!response.body) {
    return response;
  }
  const streaming = response.headers.get('content-type')?.split(';')[0] === 'text/event-stream';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let newline = false;
  return new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        /**
         * Counts each event independently; empty SSE separators release only that event's byte reservation.
         */
        transform(chunk, controller) {
          decoder.decode(chunk, { stream: true });
          for (const byte of chunk) {
            if (++bytes > stdioFrameLimit) {
              throw new Error('STDIO_HTTP_RESPONSE_LIMIT');
            }
            if (streaming && byte === 10) {
              if (newline) {
                bytes = 0;
              }
              newline = true;
            } else if (byte !== 13) {
              newline = false;
            }
          }
          controller.enqueue(chunk);
        },
        /**
         * Rejects a final incomplete UTF-8 sequence rather than accepting replacement characters.
         */
        flush() {
          decoder.decode();
        },
      })
    ),
    { status: response.status, statusText: response.statusText, headers: response.headers }
  );
}

/**
 * Owns one HTTP transport and stream writer; EOF stops admission and attempts bounded session cleanup.
 * Disconnects end this bridge. They do not prove in-flight actions stopped and never trigger a resend.
 */
export async function runStdioHttp(
  input: Readable,
  output: Writable,
  config: { endpoint: string; authorization: string },
  signal: AbortSignal
): Promise<void> {
  const lifetime = new AbortController();
  const writer = new StdioWriter(output);
  const requests = new Set<string | number>();
  const sends = new Set<Promise<void>>();
  let state: 'initialize' | 'initialized' | 'ready' = 'initialize';
  let failure: Error | undefined;
  /**
   * Closes local admission immediately and interrupts only this adapter's reads and HTTP requests.
   */
  const fail = () => {
    failure ??= new Error('STDIO_CONNECTION_ENDED');
    lifetime.abort();
    input.destroy();
  };
  const handshake = setTimeout(fail, 10000);
  /**
   * Pins the endpoint and auth, refuses redirects/proxy substitution, and bounds headers and request lifetimes.
   */
  const fetchRuntime: typeof fetch = async (url, init) => {
    if (String(url) !== config.endpoint || !['POST', 'GET'].includes(init?.method ?? '')) {
      throw new Error('STDIO_HTTP_TARGET');
    }
    const headers = new Headers(init?.headers);
    if (headers.get('authorization') !== config.authorization) {
      throw new Error('STDIO_HTTP_CREDENTIAL');
    }
    const connection = new AbortController();
    const timer = setTimeout(() => connection.abort(), init?.method === 'GET' ? 10000 : 610000);
    try {
      const response = await fetch(config.endpoint, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          lifetime.signal,
          connection.signal,
          ...(init?.signal ? [init.signal] : []),
          ...(init?.method === 'POST' ? [AbortSignal.timeout(610000)] : []),
        ]),
      });
      return boundedResponse(response);
    } finally {
      clearTimeout(timer);
    }
  };
  const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: { headers: { Authorization: config.authorization }, redirect: 'error' },
    fetch: fetchRuntime,
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  transport.setProtocolVersion('2025-11-25');
  transport.onerror = fail;
  transport.onmessage = (message) => {
    if (lifetime.signal.aborted) {
      return;
    }
    if (!('method' in message)) {
      if (message.id === undefined || !requests.delete(message.id)) {
        fail();
        return;
      }
    }
    void writer.send(message).catch(fail);
  };
  signal.addEventListener('abort', fail, { once: true });
  output.on('error', fail);
  if (signal.aborted) {
    fail();
  }
  try {
    await transport.start();
    for await (const message of readStdioMessages(input)) {
      if (lifetime.signal.aborted) {
        break;
      }
      if (state === 'initialize') {
        if (
          !isInitializeRequest(message) ||
          !('id' in message) ||
          message.id === undefined ||
          message.params.protocolVersion !== '2025-11-25'
        ) {
          throw new Error('STDIO_INITIALIZATION_REQUIRED');
        }
        requests.add(message.id);
        await transport.send(message);
        state = 'initialized';
      } else if (state === 'initialized') {
        if (!isInitializedNotification(message)) {
          throw new Error('STDIO_INITIALIZATION_REQUIRED');
        }
        await transport.send(message);
        state = 'ready';
        clearTimeout(handshake);
      } else {
        if (isInitializeRequest(message) || isInitializedNotification(message) || sends.size >= 12) {
          throw new Error('STDIO_ADMISSION_REJECTED');
        }
        if ('method' in message && 'id' in message) {
          if (requests.has(message.id) || requests.size >= 8) {
            throw new Error('STDIO_REQUEST_LIMIT');
          }
          requests.add(message.id);
        }
        const sent = transport
          .send(message)
          .catch(fail)
          .finally(() => sends.delete(sent));
        sends.add(sent);
      }
    }
    if (failure) {
      throw failure;
    }
  } finally {
    clearTimeout(handshake);
    signal.removeEventListener('abort', fail);
    output.removeListener('error', fail);
    const session = transport.sessionId;
    lifetime.abort();
    await transport.close();
    if (session) {
      // Cleanup has an independent deadline and never reports uncertain execution as stopped.
      await fetch(config.endpoint, {
        method: 'DELETE',
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
        headers: {
          Authorization: config.authorization,
          'Mcp-Session-Id': session,
          'Mcp-Protocol-Version': '2025-11-25',
        },
      })
        .then(async (response) => {
          await response.body?.cancel();
        })
        .catch(() => {});
    }
    await Promise.allSettled(sends);
    await writer.drain();
  }
}
