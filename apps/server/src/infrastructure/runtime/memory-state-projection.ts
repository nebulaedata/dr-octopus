/**
 * @author Codex
 * @description Validate only the public versioned memory status published through native Pi RPC status events.
 */
import { memoryRuntimeSchema } from '@octopus/shared/protocol/memory';
/**
 * Unknown versions, malformed JSON and oversized payloads never become browser state.
 */
export function projectMemoryState(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const value = payload as Record<string, unknown>;
  if (
    value.method !== 'setStatus' ||
    value.statusKey !== 'octopus-memory-state' ||
    typeof value.statusText !== 'string' ||
    value.statusText.length > 4000
  ) {
    return;
  }
  try {
    const parsed = memoryRuntimeSchema.safeParse(JSON.parse(value.statusText));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
}
