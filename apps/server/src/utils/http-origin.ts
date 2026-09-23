/**
 * @author Codex
 * @description Validates explicit request authority and Origin inputs without reading runtime state.
 */
import { isIP } from 'node:net';

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
