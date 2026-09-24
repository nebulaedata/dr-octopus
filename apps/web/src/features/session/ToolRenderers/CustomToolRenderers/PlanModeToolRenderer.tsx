/**
 * @author Codex
 * @description Renders pi-plan-mode questions and decision-ready plans from structured ToolProjection fields.
 */

import { Badge } from '@octopus/ui/components/badge';
import { Separator } from '@octopus/ui/components/separator';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useI18n } from '@/i18n/use-i18n';
import { ToolContent, ToolSection } from '../ToolRendererParts';
import { projectPlanModeTool } from '@/features/session/utils/plan-mode-projection';
import type { ToolRendererProps } from '../ToolRendererParts';

/**
 * Presents Plan helper results while retaining the universal textual fallback for invalid contracts.
 */
export function PlanModeToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const projection = projectPlanModeTool(tool);
  if (tool.name === 'plan_mode_complete' && projection.plan !== undefined) {
    return (
      <ToolSection title={t('session.planTool.proposedPlan', 'Proposed plan')}>
        <div className="max-h-[32rem] overflow-auto rounded-lg border bg-background p-4 text-sm">
          <MarkdownRenderer className="max-w-none break-words">{projection.plan}</MarkdownRenderer>
        </div>
      </ToolSection>
    );
  }
  if (tool.name === 'plan_mode_question' && projection.questions.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {projection.questions.map((question, index) => (
          <div key={question.id} className="flex flex-col gap-2">
            {index === 0 ? null : <Separator />}
            <ToolSection title={question.header}>
              <p className="whitespace-pre-wrap text-sm">{question.question}</p>
              <div className="flex flex-col gap-1.5">
                {question.options.map((option) => (
                  <div key={option.label} className="rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{option.label}</span>
                    {option.description === undefined ? null : (
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    )}
                  </div>
                ))}
              </div>
              {question.answer === undefined ? (
                <Badge variant="outline">
                  {t('session.planTool.waitingResponse', 'Waiting for response')}
                </Badge>
              ) : (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">
                    {t('session.planTool.answerPrefix', 'Answer: {{answer}}', { answer: question.answer })}
                  </span>
                  {question.wasCustom === true ? (
                    <Badge className="ml-2" variant="outline">
                      {t('session.planTool.custom', 'Custom')}
                    </Badge>
                  ) : null}
                  {question.note === undefined ? null : (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{question.note}</p>
                  )}
                </div>
              )}
            </ToolSection>
          </div>
        ))}
        {projection.cancelled ? (
          <p className="text-sm text-destructive">
            {projection.reason === undefined
              ? t('session.planTool.cancelled', 'Question cancelled.')
              : t('session.planTool.cancelledWithReason', 'Question cancelled: {{reason}}', {
                  reason: projection.reason,
                })}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
      <ToolContent blocks={tool.content} />
    </ToolSection>
  );
}
