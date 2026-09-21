/**
 * @author Codex
 * @description Project bounded memory runtime status through native TUI and RPC surfaces.
 */
import { memoryRuntimeSchema } from '@octopus/shared/protocol/memory';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { MemoryRuntimeSnapshot, MemoryStatus } from '../definitions/types.js';

/**
 * Publish only public status fields, omitting all storage paths and source text.
 */
export function publishMemoryStatus(
  ctx: ExtensionContext,
  status: MemoryStatus,
  curator: MemoryRuntimeSnapshot['curator'] = 'idle',
  errorCode?: string
) {
  const state = memoryRuntimeSchema.parse({ ...status, curator, errorCode });
  if (ctx.mode === 'rpc') {
    ctx.ui.setStatus('octopus-memory-state', JSON.stringify(state));
  } else if (ctx.mode === 'tui') {
    // A store failure must not wear the mode badge (the stub mode is unknown, not "off"),
    // and it outranks curator wording: curation never ran, so say the store is down.
    const detail =
      state.availability === 'unavailable'
        ? 'store unavailable'
        : state.mode +
          (curator === 'running' ? ' · curating' : curator === 'failed' ? ' · curate failed' : '');
    ctx.ui.setStatus('octopus-memory-state', ctx.ui.theme.fg('dim', 'memory · ' + detail));
  }
}
