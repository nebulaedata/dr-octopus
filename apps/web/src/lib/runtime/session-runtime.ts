/**
 * @author Codex
 * @description Composes the tab-scoped Session runtime registry with realtime transport and projection stores.
 */

import { sessionStores } from '@/stores/session';
import { realtimeClient } from '@/utils/realtime-client';
import { SessionRuntimeRegistry } from './session-runtime-registry';

export const browserSessionRuntime = new SessionRuntimeRegistry(realtimeClient, {
  onSessionIdle: (sessionId) => sessionStores.markIdle(sessionId),
});
