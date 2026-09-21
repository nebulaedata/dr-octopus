/**
 * @author Codex
 * @description Encapsulates Session channel transport policy, error projection, and bounded WebSocket writes.
 */

import { isIP } from 'node:net';
import { toPublicError } from '../../lib/errors/public-error.js';
import { DEFAULT_LOCALE } from '../../lib/i18n/negotiate-locale.js';
import type { WebSocket } from 'ws';
import type { PublicLocale } from '../../lib/i18n/negotiate-locale.js';
import type { ProtocolErrorMessage, ServerRealtimeMessage } from '@octopus/shared/protocol';

const SLOW_CONSUMER_BYTES = 1024 * 1024;
const CLOSE_CONSUMER_BYTES = 4 * SLOW_CONSUMER_BYTES;

/**
 * Validates Host before Origin so DNS rebinding cannot create a trusted same-origin request.
 *
 * @param origin Origin supplied by the WebSocket handshake.
 * @param allowOrigin Configured origin allow-list or predicate.
 * @param request Request authority; custom domains require an explicitly allowed origin.
 * @returns Whether the transport may accept the connection.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowOrigin: string[] | ((origin: string) => boolean),
  request?: { headers: { host?: string }; protocol?: string }
): boolean {
  const allowed =
    typeof allowOrigin === 'function' ? allowOrigin : (value: string) => allowOrigin.includes(value);
  if (request?.headers.host) {
    try {
      const target = new URL(`${request.protocol ?? 'http'}://${request.headers.host}`);
      const hostname = target.hostname.replace(/^\[|\]$/g, '');
      if (
        !['http:', 'https:'].includes(target.protocol) ||
        target.username ||
        target.password ||
        target.pathname !== '/' ||
        target.search ||
        target.hash ||
        (hostname !== 'localhost' &&
          !isIP(hostname) &&
          !allowed(target.origin) &&
          !allowed(new URL(`https://${request.headers.host}`).origin))
      ) {
        return false;
      }
      if (origin === target.origin) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return origin === undefined || allowed(origin);
}

/**
 * Best-effort extracts request identity from invalid input for protocol error correlation.
 *
 * @param source Raw WebSocket message text.
 * @returns The request id when the input contains a string identifier.
 */
export function extractRequestId(source: string): string | undefined {
  try {
    const parsed = JSON.parse(source) as { requestId?: unknown };
    return typeof parsed.requestId === 'string' ? parsed.requestId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends a message with bounded buffering so slow consumers cannot exhaust Server memory.
 *
 * @param socket Target WebSocket transport.
 * @param message Public channel message.
 */
export function sendChannelMessage(socket: WebSocket, message: ServerRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  if (socket.bufferedAmount >= CLOSE_CONSUMER_BYTES) {
    socket.close(1008, 'Slow consumer');
    return;
  }
  if (socket.bufferedAmount >= SLOW_CONSUMER_BYTES && message.type === 'agent.event') {
    return;
  }
  socket.send(JSON.stringify(message));
}

/**
 * Projects an internal failure onto the stable public channel error contract.
 *
 * @param socket Target WebSocket transport.
 * @param requestId Optional request identity recovered from the input.
 * @param error Internal failure to project.
 * @param locale Response locale captured when the connection was established.
 */
export function sendChannelError(
  socket: WebSocket,
  requestId: string | undefined,
  error: unknown,
  locale: PublicLocale = DEFAULT_LOCALE
): void {
  const projected = toPublicError(error, locale);
  const message: ProtocolErrorMessage = {
    type: 'error',
    requestId,
    code: projected.code,
    message: projected.message,
    retryable: projected.retryable,
  };
  sendChannelMessage(socket, message);
}
