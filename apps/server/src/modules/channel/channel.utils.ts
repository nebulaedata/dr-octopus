/**
 * @author Codex
 * @description Encapsulates Session channel transport policy, error projection, and bounded WebSocket writes.
 */

import { toPublicError } from '../../infrastructure/errors/public-error.js';
import { DEFAULT_LOCALE } from '../../infrastructure/i18n/negotiate-locale.js';
import type { ProtocolErrorMessage, ServerRealtimeMessage } from '@octopus/shared/protocol';
import type { WebSocket } from 'ws';
import type { PublicLocale } from '../../infrastructure/i18n/negotiate-locale.js';
import type { WorkspaceReferenceDto } from '@octopus/shared/protocol';

const SLOW_CONSUMER_BYTES = 1024 * 1024;
const CLOSE_CONSUMER_BYTES = 4 * SLOW_CONSUMER_BYTES;

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

/**
 * Creates the model-facing suffix persisted by Pi for deterministic Session recovery.
 *
 * @param requestId Request identity used to recognize Host-owned prompt context.
 * @param references Server-validated Workspace-relative references.
 * @returns An empty string when no references exist, otherwise an escaped private prompt suffix.
 */
export function createWorkspaceReferencePromptSuffix(
  requestId: string,
  references: readonly WorkspaceReferenceDto[]
): string {
  if (references.length === 0) {
    return '';
  }
  const entries = references
    .map(
      (reference) => `  <reference kind="${reference.kind}" path="${escapeXmlAttribute(reference.path)}" />`
    )
    .join('\n');
  return `\n<host_workspace_reference_request id="${escapeXmlAttribute(requestId)}" />\n<host_workspace_references version="1" trust="untrusted-user-selected-paths">\n${entries}\n</host_workspace_references>`;
}

/**
 * Escapes untrusted path and request metadata used in XML-like prompt attributes.
 *
 * @param value Raw attribute value.
 * @returns Attribute-safe text that cannot create additional prompt elements.
 */
function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
