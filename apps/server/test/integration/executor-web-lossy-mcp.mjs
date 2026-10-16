/**
 * @author Codex
 * @description Owns a loopback test proxy that drops one real MCP action reply while leaving its upstream execution and other protocol traffic intact.
 */
import assert from 'node:assert/strict';
import { createServer, request as forward } from 'node:http';

/**
 * Passes protocol bytes unchanged; only the first PowerShell response socket can be explicitly cut by the fixture.
 */
export function createLossyMcpProxy() {
  let upstream;
  let actionResponse;
  let dropped = false;
  let shellRequests = 0;
  let cancellationNotifications = 0;
  const requests = new Set();
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const message = bytes.length ? JSON.parse(bytes.toString()) : undefined;
      if (message?.method === 'notifications/cancelled') cancellationNotifications++;
      if (message?.method === 'tools/call' && message.params?.name === 'powershell') {
        shellRequests++;
        if (shellRequests === 1) actionResponse = response;
      }
      const headers = { ...request.headers, host: upstream.host };
      delete headers.connection;
      delete headers['transfer-encoding'];
      const owned = forward(upstream, { method: request.method, headers }, (reply) => {
        reply.once('error', () => response.destroy());
        if (response.destroyed) reply.resume();
        else {
          response.writeHead(reply.statusCode, reply.headers);
          reply.pipe(response);
        }
      });
      requests.add(owned);
      owned.once('close', () => requests.delete(owned));
      owned.once('error', () => {
        if (!response.destroyed) {
          response.writeHead(502);
          response.end('Owned upstream unavailable');
        }
      });
      owned.end(bytes);
    } catch {
      if (!response.destroyed) {
        response.writeHead(400);
        response.end('Invalid fixture protocol body');
      }
    }
  });

  /**
   * Connects only the exported production numeric loopback endpoint; returns an isolated client URL.
   */
  async function start(url) {
    upstream = new URL(url);
    assert.equal(upstream.protocol, 'http:');
    assert.equal(upstream.hostname, '127.0.0.1');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port + upstream.pathname;
  }

  /**
   * Cuts the downstream reply only; sends no cancellation, never destroys the upstream request.
   */
  function dropReply() {
    assert.ok(actionResponse && !actionResponse.destroyed && !dropped);
    dropped = true;
    actionResponse.destroy();
  }

  /**
   * Returns observed method counts, with no headers, credentials or raw messages.
   */
  function evidence() {
    return { dropped, shellRequests, cancellationNotifications };
  }

  /**
   * Ends only owned proxy requests and sockets after action verification has drained.
   */
  async function close() {
    for (const request of requests) request.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { start, dropReply, evidence, close };
}
