/**
 * @author Codex
 * @description Renders pi-goal completion, blocker, and external-wait results from structured details.
 */

import { formatDateTime } from '@/utils/date';
import { Badge } from '@octopus/ui/components/badge';
import { Separator } from '@octopus/ui/components/separator';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent, ToolSection } from '../ToolRendererParts';
import { projectGoalToolDetails } from './goal-projection';
import type { ToolRendererProps } from '../types';

/**
 * Renders one Goal terminal or wait tool while retaining its model-facing output.
 */
export function GoalToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const details = projectGoalToolDetails(tool);
  const primaryLabel =
    tool.name === 'goal_complete'
      ? t('session.goalTool.completionEvidence', 'Completion evidence')
      : tool.name === 'goal_blocked'
        ? t('session.goalTool.blocker', 'Blocker')
        : t('session.goalTool.waiting', 'Waiting');
  const primaryText = tool.name === 'goal_complete' ? details.summary : details.reason;
  return (
    <div className="flex flex-col gap-3">
      {details.goal === undefined ? null : (
        <ToolSection title={t('session.goalTool.goal', 'Goal')}>
          <p className="whitespace-pre-wrap text-sm">{details.goal}</p>
          {details.goalId === undefined ? null : (
            <span className="font-mono text-xs text-muted-foreground">{details.goalId}</span>
          )}
        </ToolSection>
      )}
      {primaryText === undefined ? null : (
        <>
          {details.goal === undefined ? null : <Separator />}
          <ToolSection title={primaryLabel}>
            <p className="whitespace-pre-wrap text-sm">{primaryText}</p>
          </ToolSection>
        </>
      )}
      {details.evidence === undefined ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.goalTool.evidence', 'Evidence')}>
            <p className="whitespace-pre-wrap text-sm">{details.evidence}</p>
            {details.repeatedTurns === undefined ? null : (
              <Badge variant="outline">
                {t('session.goalTool.repeatedTurns', '{{count}} repeated turns', {
                  count: details.repeatedTurns,
                })}
              </Badge>
            )}
          </ToolSection>
        </>
      )}
      {details.resumeAfterMs === undefined && details.resumeAt === undefined ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.goalTool.resume', 'Resume')}>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {details.resumeAfterMs === undefined ? null : (
                <Badge variant="outline">
                  {t('session.goalTool.afterDelay', 'after {{delay}}', {
                    delay: formatDelay(details.resumeAfterMs),
                  })}
                </Badge>
              )}
              {details.resumeAt === undefined ? null : <span>{formatDateTime(details.resumeAt)}</span>}
              {details.requestedResumeAfterMs === undefined ||
              details.requestedResumeAfterMs === details.resumeAfterMs ? null : (
                <span>
                  {t('session.goalTool.clampedNote', 'Requested {{delay}}; clamped by pi-goal.', {
                    delay: formatDelay(details.requestedResumeAfterMs),
                  })}
                </span>
              )}
            </div>
          </ToolSection>
        </>
      )}
      {tool.content.length === 0 ? null : (
        <>
          <Separator />
          <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
            <ToolContent blocks={tool.content} />
          </ToolSection>
        </>
      )}
    </div>
  );
}

/**
 * Formats a bounded millisecond delay for compact Goal wait metadata.
 *
 * @param milliseconds Delay reported by pi-goal.
 * @returns Compact human-readable duration.
 */
function formatDelay(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${String(minutes)}m` : `${String(Math.round(minutes / 60))}h`;
}
