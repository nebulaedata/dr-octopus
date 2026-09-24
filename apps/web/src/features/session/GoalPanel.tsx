/**
 * @author Codex
 * @description Presents the current Session's server-validated pi-goal state above the Composer.
 */

import { formatDateTime } from '@/utils/date';
import {
  CirclePauseIcon,
  Clock3Icon,
  GaugeIcon,
  LoaderCircleIcon,
  TargetIcon,
  TimerIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useMemoizedFn } from 'ahooks';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from 'zustand';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Progress } from '@octopus/ui/components/progress';
import { Spinner } from '@octopus/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { formatDuration } from '@octopus/custom-ui/components/elapsed-time';
import { createGoalClearCommand, GOAL_CLEAR_MESSAGE } from '@/features/session/utils/goal-command';
import type { GoalStateDto, GoalStatus } from '@octopus/shared/protocol';
import type { Translate } from '@/i18n/use-i18n';

/**
 * Renders the active or stopped Goal and stays absent before Goal mode is used or after it is cleared.
 */
export function GoalPanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const store = sessionStores.ensure(sessionId);
  const goal = useStore(store, (state) => state.goal);
  const runtimeState = useStore(store, (state) => state.runtimeState);
  const submitting = useStore(store, (state) => state.pendingUserRequestIds.length > 0);
  const send = useRealtimeCommand();

  /**
   * Clears a stopped Goal through pi-goal's canonical command so the dismissal survives refresh.
   */
  const clearGoal = useMemoizedFn((): void => {
    const state = store.getState();
    if (
      state.goal === undefined ||
      state.goal.status === 'active' ||
      state.runtimeState !== 'idle' ||
      state.pendingUserRequestIds.length > 0
    ) {
      return;
    }
    const requestId = uuidv4();
    try {
      send(createGoalClearCommand(requestId, sessionId, state.runtimeId, state.epoch));
      store.getState().appendOptimisticUserMessage(requestId, GOAL_CLEAR_MESSAGE);
    } catch (error) {
      store
        .getState()
        .setError(
          error instanceof Error ? error.message : t('session.goal.clearFailed', 'Could not clear the Goal.')
        );
    }
  });

  if (goal === undefined) {
    return null;
  }
  const tokenPercent =
    goal.tokenBudget === undefined ? undefined : Math.min(100, (goal.tokensUsed / goal.tokenBudget) * 100);
  return (
    <div className="mx-auto w-[calc(100%-20px)] sm:w-[min(calc(100%-32px),880px)]">
      <Collapsible defaultOpen className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-1 pr-2">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
            <TargetIcon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{goal.objective}</span>
            <Badge variant={goalStatusVariant(goal.status)}>
              <GoalStatusIcon goal={goal} />
              {goal.waiting === undefined
                ? goalStatusLabel(t, goal.status)
                : t('session.goal.status.waiting', 'waiting')}
            </Badge>
          </CollapsibleTrigger>
          {goal.status === 'active' ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear stopped goal"
                    disabled={runtimeState !== 'idle' || submitting}
                    onClick={clearGoal}
                  >
                    {submitting ? <Spinner /> : <XIcon />}
                  </Button>
                }
              />
              <TooltipContent>{t('session.goal.clearStopped', 'Clear stopped goal')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <CollapsibleContent className="border-t">
          <div className="flex flex-col gap-3 p-4">
            <p className="whitespace-pre-wrap text-sm">{goal.objective}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <TimerIcon className="size-3.5" />
                {t('session.goal.activeTime', '{{duration}} active', {
                  duration: formatDuration(goal.timeUsedSeconds * 1_000, 'compact'),
                })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <GaugeIcon className="size-3.5" />
                {t('session.goal.automaticResponses', '{{count}} automatic responses', {
                  count: goal.automaticModelTurns,
                })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3Icon className="size-3.5" />
                {t('session.goal.updatedAt', 'Updated {{date}}', { date: formatDateTime(goal.updatedAt) })}
              </span>
            </div>
            {goal.tokenBudget === undefined ? null : (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('session.goal.tokenBudget', 'Token budget')}</span>
                  <span>
                    {goal.tokensUsed.toLocaleString()} / {goal.tokenBudget.toLocaleString()}
                  </span>
                </div>
                <Progress value={tokenPercent ?? null} />
              </section>
            )}
            {goal.waiting === undefined ? null : (
              <div className="rounded-lg bg-muted p-3 text-xs">
                <p>{goal.waiting.reason}</p>
                {goal.waiting.resumeAt === undefined ? null : (
                  <p className="mt-1 text-muted-foreground">
                    {t('session.goal.safetyResume', 'Safety resume: {{date}}', {
                      date: formatDateTime(goal.waiting.resumeAt),
                    })}
                  </p>
                )}
              </div>
            )}
            {goal.safetyPauseCause === undefined ? null : (
              <p className="inline-flex items-center gap-1.5 text-xs text-warning-foreground">
                <TriangleAlertIcon className="size-3.5" />
                {goal.safetyPauseCause === 'continuation_limit'
                  ? t(
                      'session.goal.continuationLimit',
                      'Automatic response limit reached. Use /goal to review and continue.'
                    )
                  : t(
                      'session.goal.noProgressGuard',
                      'No-progress guard paused this Goal. Use /goal to review it.'
                    )}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Chooses the compact user-facing label for an upstream Goal status.
 *
 * @param t Active translator.
 * @param status Current Goal status.
 * @returns Display label.
 */
function goalStatusLabel(t: Translate, status: GoalStatus): string {
  return (
    {
      active: t('session.goal.status.active', 'active'),
      paused: t('session.goal.status.paused', 'paused'),
      blocked: t('session.goal.status.blocked', 'blocked'),
      budget_limited: t('session.goal.status.budgetLimited', 'budget limited'),
      usage_limited: t('session.goal.status.usageLimited', 'usage limited'),
    }[status] ?? status
  );
}

/**
 * Selects the semantic Badge treatment for one Goal state.
 *
 * @param status Current Goal status.
 * @returns Supported shared Badge variant.
 */
function goalStatusVariant(status: GoalStatus): 'secondary' | 'destructive' | 'warning' | 'outline' {
  if (status === 'blocked' || status === 'budget_limited' || status === 'usage_limited') {
    return 'destructive';
  }
  return status === 'paused' ? 'warning' : 'secondary';
}

/**
 * Renders the state icon without exposing Goal semantics to generic layout components.
 *
 * @param goal Current Goal projection.
 */
function GoalStatusIcon({ goal }: { goal: GoalStateDto }) {
  if (goal.status === 'active' && goal.waiting === undefined) {
    return <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />;
  }
  if (goal.status === 'paused') {
    return <CirclePauseIcon data-icon="inline-start" />;
  }
  return <TriangleAlertIcon data-icon="inline-start" />;
}
