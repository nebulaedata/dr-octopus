/**
 * @author Codex
 * @description Displays Session errors with dismissal or runtime bootstrap recovery.
 */

import { useStore } from 'zustand';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Button } from '@octopus/ui/components/button';
import { sessionStores } from '@/stores/session';

/**
 * Prioritizes runtime errors over operation errors and offers the matching recovery action.
 */
export function SessionErrorAlert({
  sessionId,
  runtimeError,
  onRetry,
}: {
  sessionId: string;
  runtimeError: string | undefined;
  onRetry: () => void;
}) {
  const store = sessionStores.ensure(sessionId);
  const projectionError = useStore(store, (state) => state.error);
  const error = runtimeError ?? projectionError;

  /**
   * Dismisses operation errors or restarts bootstrap before retrying the runtime query.
   */
  function handleAction() {
    if (runtimeError === undefined) {
      store.getState().setError(undefined);
      return;
    }
    store.getState().beginBootstrap();
    void onRetry();
  }

  if (!error) {
    return null;
  }

  return (
    <Alert variant="destructive" className="pointer-events-auto shadow-lg shadow-black/5 dark:shadow-white/5">
      <AlertTitle>{runtimeError === undefined ? 'Operation failed' : 'Session unavailable'}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={handleAction}>
          {runtimeError === undefined ? 'Dismiss' : 'Retry'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
