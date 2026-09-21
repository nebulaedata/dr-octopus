/**
 * @author Codex
 * @description Formats the development startup summary and discovers reachable server URLs.
 */

import { networkInterfaces } from 'node:os';
import { styleText } from 'node:util';
import type { InspectColor } from 'node:util';

export interface ServerReadyMessageOptions {
  host: string;
  port: number;
  localUrl: string;
  readyInMs: number;
}

/**
 * Creates a Vite-style startup summary for the local development server.
 *
 * @param options Bound server address and measured startup duration.
 * @returns A multiline terminal message with local and network access details.
 */
export function createServerReadyMessage(options: ServerReadyMessageOptions): string {
  const localUrl = normalizeUrl(options.localUrl);
  const networkUrls = resolveNetworkUrls(options.host, options.port);
  const networkLines =
    networkUrls.length > 0
      ? createNetworkUrlLines(networkUrls)
      : [
          `  ${color('green', '➜')}  Network: ${color('gray', `set ${color('whiteBright', 'SERVER_HOST=0.0.0.0')} to expose`)}`,
        ];

  return [
    '',
    `  ${color('green', 'Dr.Octopus')} Server ready in ${color('cyan', String(Math.max(0, Math.round(options.readyInMs))))} ms`,
    '',
    `  ${color('green', '➜')}  Local:   ${color('cyan', localUrl)}`,
    ...networkLines,
  ].join('\n');
}

/**
 * Formats each reachable address with the same label Vite repeats for multiple interfaces.
 *
 * @param networkUrls Reachable HTTP URLs to display.
 * @returns One consistently labelled terminal line per URL.
 */
export function createNetworkUrlLines(networkUrls: readonly string[]): string[] {
  return networkUrls.map((url) => `  ${color('green', '➜')}  Network: ${color('cyan', url)}`);
}

/**
 * Applies terminal styling without rejecting Turbo's redirected output stream.
 *
 * @param format ANSI style supported by Node.js text formatting.
 * @param text Text displayed in the development startup summary.
 * @returns Text wrapped in the requested ANSI style.
 */
function color(format: InspectColor, text: string): string {
  return styleText(format, text, { validateStream: false });
}

/**
 * Resolves addresses that other devices can use for the configured binding.
 *
 * @param host Host passed to Fastify listen.
 * @param port Bound TCP port.
 * @returns Stable, unique HTTP URLs reachable beyond loopback.
 */
function resolveNetworkUrls(host: string, port: number): string[] {
  if (isLoopbackHost(host)) {
    return [];
  }

  if (host !== '0.0.0.0' && host !== '::') {
    return [`http://${formatUrlHost(host)}:${String(port)}/`];
  }

  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${String(port)}/`);

  return [...new Set(addresses)].sort();
}

/**
 * Determines whether a binding is intentionally local-only.
 *
 * @param host Configured listening host.
 * @returns True when the host cannot be reached from another device.
 */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Adds brackets around IPv6 literals for use in an HTTP URL.
 *
 * @param host Host name or IP address.
 * @returns A URL-safe authority host.
 */
function formatUrlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Ensures the displayed local origin has a conventional trailing slash.
 *
 * @param url Listening origin reported by Fastify.
 * @returns Normalized URL when parsable, otherwise the original value.
 */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}
