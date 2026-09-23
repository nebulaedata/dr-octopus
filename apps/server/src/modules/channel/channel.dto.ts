/**
 * @author Codex
 * @description Decodes and validates versioned, untrusted Session channel messages before application dispatch.
 */

import {
  PERMISSION_MODES,
  RUNTIME_WORK_MODES,
  THINKING_LEVELS,
  WorkspaceReferencesSchema,
} from '@octopus/shared/protocol';
import { parseKnowledgeModeConfig } from '@octopus/shared/protocol/knowledge';
import { isRecord } from '../../utils/value-utils.js';
import type { ClientRealtimeMessage } from '@octopus/shared/protocol';

const COMMAND_TYPES = new Set<ClientRealtimeMessage['type']>([
  'ping',
  'session.focus',
  'session.subscribe',
  'session.unsubscribe',
  'agent.prompt',
  'agent.steer',
  'agent.follow-up',
  'agent.abort',
  'agent.compact',
  'agent.abort-retry',
  'agent.set-model',
  'agent.set-thinking',
  'agent.set-work-mode',
  'agent.set-permission-mode',
  'agent.set-queue-mode',
  'extension.ui.response',
]);

/**
 * Converts untrusted JSON into the closed shared command union or throws a stable validation error.
 */
export function decodeClientMessage(source: string): ClientRealtimeMessage {
  const value = parseClientMessageEnvelope(source);
  const type = value['type'] as ClientRealtimeMessage['type'];
  if (type === 'ping' || type === 'session.focus') {
    return value as unknown as ClientRealtimeMessage;
  }
  switch (type) {
    case 'agent.prompt':
      requirePayloadString(value, 'message');
      requireOptionalPayloadStringArray(value, 'attachmentIds');
      requireOptionalWorkspaceReferences(value);
      break;
    case 'agent.steer':
    case 'agent.follow-up':
      requirePayloadString(value, 'message');
      requireOptionalPayloadStringArray(value, 'attachmentIds');
      requireOptionalWorkspaceReferences(value);
      break;
    case 'agent.set-model':
      requirePayloadString(value, 'provider');
      requirePayloadString(value, 'modelId');
      break;
    case 'agent.set-thinking':
      requirePayloadEnum(value, 'level', [...THINKING_LEVELS]);
      break;
    case 'agent.set-work-mode':
      requirePayloadEnum(value, 'mode', [...RUNTIME_WORK_MODES]);
      if (isRecord(value['payload']) && value['payload']['knowledge'] !== undefined) {
        value['payload']['knowledge'] = parseKnowledgeModeConfig(value['payload']['knowledge']);
      }
      break;
    case 'agent.set-permission-mode':
      requirePayloadEnum(value, 'mode', [...PERMISSION_MODES]);
      break;
    case 'agent.set-queue-mode':
      requirePayloadEnum(value, 'queue', ['steering', 'follow-up']);
      requirePayloadEnum(value, 'mode', ['all', 'one-at-a-time']);
      break;
    case 'extension.ui.response':
      requirePayloadString(value, 'extensionRequestId');
      requireOptionalPayloadType(value, 'value', 'string');
      requireOptionalPayloadType(value, 'confirmed', 'boolean');
      requireOptionalPayloadLiteral(value, 'cancelled', true);
      break;
    case 'session.subscribe':
    case 'session.unsubscribe':
    case 'agent.abort':
    case 'agent.compact':
    case 'agent.abort-retry':
      break;
    default: {
      const unsupportedType: never = type;
      throw new Error('Unsupported message type.', { cause: unsupportedType });
    }
  }
  return value as unknown as ClientRealtimeMessage;
}

/**
 * Parses the transport payload and validates fields shared by command envelopes.
 *
 * @param source Raw WebSocket message text.
 * @returns A structurally valid command envelope ready for payload-specific validation.
 * @throws When JSON syntax or shared envelope fields are invalid.
 */
function parseClientMessageEnvelope(source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Message must be valid JSON.');
  }
  if (
    !isRecord(value) ||
    typeof value['type'] !== 'string' ||
    !COMMAND_TYPES.has(value['type'] as ClientRealtimeMessage['type']) ||
    typeof value['requestId'] !== 'string' ||
    value['requestId'].length === 0
  ) {
    throw new Error('Message type and requestId are invalid.');
  }
  if (value['type'] === 'ping') {
    return value;
  }
  if (value['type'] === 'session.focus' && value['sessionId'] === null) {
    return value;
  }
  if (typeof value['sessionId'] !== 'string' || value['sessionId'].length === 0) {
    throw new Error('sessionId is required.');
  }
  if (value['runtimeId'] !== undefined && typeof value['runtimeId'] !== 'string') {
    throw new Error('runtimeId must be a string.');
  }
  if (
    value['epoch'] !== undefined &&
    (!Number.isSafeInteger(value['epoch']) || (value['epoch'] as number) < 1)
  ) {
    throw new Error('epoch must be a positive integer.');
  }
  return value;
}

/**
 * Requires one string field inside a command payload.
 */
function requirePayloadString(message: Record<string, unknown>, field: string): void {
  const payload = message['payload'];
  if (!isRecord(payload) || typeof payload[field] !== 'string') {
    throw new Error(`payload.${field} is required.`);
  }
}

/**
 * Requires an optional payload field to contain only strings when present.
 */
function requireOptionalPayloadStringArray(message: Record<string, unknown>, field: string): void {
  const payload = message['payload'];
  if (
    !isRecord(payload) ||
    (payload[field] !== undefined &&
      (!Array.isArray(payload[field]) || !payload[field].every((item) => typeof item === 'string')))
  ) {
    throw new Error(`payload.${field} must be an array of strings.`);
  }
}

/**
 * Requires optional Workspace references to satisfy the shared closed runtime schema.
 */
function requireOptionalWorkspaceReferences(message: Record<string, unknown>): void {
  const payload = message['payload'];
  if (
    !isRecord(payload) ||
    (payload['workspaceReferences'] !== undefined &&
      !WorkspaceReferencesSchema.safeParse(payload['workspaceReferences']).success)
  ) {
    throw new Error('payload.workspaceReferences is invalid.');
  }
}

/**
 * Requires one payload field to match a closed set of string values.
 */
function requirePayloadEnum(
  message: Record<string, unknown>,
  field: string,
  allowedValues: readonly string[]
): void {
  const payload = message['payload'];
  if (!isRecord(payload) || !allowedValues.includes(payload[field] as string)) {
    throw new Error(`payload.${field} is invalid.`);
  }
}

/**
 * Requires an optional payload field to have the expected primitive type when present.
 */
function requireOptionalPayloadType(
  message: Record<string, unknown>,
  field: string,
  expectedType: 'boolean' | 'string'
): void {
  const payload = message['payload'];
  if (!isRecord(payload) || (payload[field] !== undefined && typeof payload[field] !== expectedType)) {
    throw new Error(`payload.${field} must be a ${expectedType}.`);
  }
}

/**
 * Requires an optional payload field to equal its sole supported literal when present.
 */
function requireOptionalPayloadLiteral(
  message: Record<string, unknown>,
  field: string,
  expectedValue: true
): void {
  const payload = message['payload'];
  if (!isRecord(payload) || (payload[field] !== undefined && payload[field] !== expectedValue)) {
    throw new Error(`payload.${field} is invalid.`);
  }
}
