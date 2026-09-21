/**
 * @author Codex
 * @description Shares restart mutations, interruption confirmation and errors between Session action surfaces.
 */
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useSafeState } from 'ahooks';
import { restartSession } from '@/api/sessions';
import { ApiRequestError } from '@/utils/request';
import { queryKeys } from '@/queries/query-keys';
import type { RestartSessionBody, SessionDto } from '@octopus/shared/protocol';

interface RestartAttempt {
  session: SessionDto;
  body: RestartSessionBody;
}
const mutationKey = ['session-restart'];

/**
 * Keeps each confirmation tied to its original generation while sharing pending state across buttons.
 */
export function useRestartSession() {
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useSafeState<RestartAttempt | undefined>();
  const [error, setError] = useSafeState<string | undefined>();
  const pending = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as RestartAttempt).session.id,
  });
  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: ({ session, body }: RestartAttempt) => restartSession(session.workspaceId, session.id, body),
    onSuccess: () => {
      setConfirmation(undefined);
      setError(undefined);
    },
    onError: (failure, attempt) => {
      if (failure instanceof ApiRequestError && failure.code === 'SESSION_BUSY') {
        setConfirmation(attempt);
      } else {
        setError(failure.message);
        setConfirmation(undefined);
      }
    },
    onSettled: async (_result, _failure, { session }) => {
      await client.invalidateQueries({ queryKey: queryKeys.sessions(session.workspaceId) });
    },
  });

  /**
   * Starts an idle restart immediately; busy state always remains subject to Server revalidation.
   */
  const start = (session: SessionDto): void => {
    if (pending.includes(session.id) || session.runtimeControl?.restart.status === 'restarting') {
      return;
    }
    setError(undefined);
    const attempt: RestartAttempt = {
      session,
      body: {
        expectedRuntime: session.runtime
          ? { runtimeId: session.runtime.runtimeId, epoch: session.runtime.epoch }
          : null,
        allowInterrupt: false,
      },
    };
    if (session.runtime?.state === 'running') {
      setConfirmation(attempt);
    } else {
      mutation.mutate(attempt);
    }
  };

  /**
   * Authorizes interruption only for the generation displayed by this confirmation.
   */
  const confirm = (): void => {
    if (!confirmation || mutation.isPending) {
      return;
    }
    mutation.mutate({ ...confirmation, body: { ...confirmation.body, allowInterrupt: true } });
  };

  return {
    start,
    confirm,
    confirmation,
    error,
    pending,
    isPending: mutation.isPending,
    dismiss: () => {
      setConfirmation(undefined);
      setError(undefined);
    },
  };
}
