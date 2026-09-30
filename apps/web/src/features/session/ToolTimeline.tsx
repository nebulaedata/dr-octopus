/**
 * @author Codex
 * @description Presents a consecutive tool group while keeping streaming subscriptions local to each row.
 */
import { useStore } from 'zustand';
import { Timeline } from '@octopus/custom-ui/components/timeline';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import { Message, MessageContent } from '@octopus/ui/components/message';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { useI18n } from '@/i18n/use-i18n';
import { ToolCard } from './ToolCard';

/**
 * Uses the first tool's stable group identity so append-only execution preserves disclosures and scroll anchors.
 */
export function ToolTimeline({ sessionId, toolIds }: { sessionId: string; toolIds: string[] }) {
  const { t } = useI18n();
  const status = useStore(sessionStores.ensure(sessionId), (state) => {
    if (toolIds.some((id) => state.toolsById[id] === undefined || state.toolsById[id].status === 'running')) {
      return 'running';
    }
    return toolIds.some((id) => state.toolsById[id]?.status === 'error') ? 'error' : 'success';
  });
  let statusLabel = t('session.toolTimeline.completed', 'Completed');
  if (status === 'running') {
    statusLabel = t('session.toolTimeline.running', 'Running');
  } else if (status === 'error') {
    statusLabel = t('session.toolTimeline.error', 'Contains errors');
  }
  return (
    <MessageScrollerItem>
      <Message align="start">
        <MessageContent>
          <Card size="sm" className="min-w-0 gap-1 border py-2 ring-0">
            <CardHeader className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
              <CardTitle className="group-data-[size=sm]/card:text-xs">
                {t('session.toolTimeline.title', 'Tool calls')}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-2 text-xs">
                <span>
                  {toolIds.length === 1
                    ? t('session.toolTimeline.singleCall', '1 call')
                    : t('session.toolTimeline.multipleCalls', '{{total}} calls', { total: toolIds.length })}
                </span>
                <span aria-hidden>·</span>
                <span>{statusLabel}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Timeline aria-label="Tool calls">
                {toolIds.map((toolId) => (
                  <ToolTimelineRow key={toolId} sessionId={sessionId} toolId={toolId} />
                ))}
              </Timeline>
            </CardContent>
          </Card>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

/**
 * Isolates parameter and result streaming to the corresponding tool disclosure.
 */
function ToolTimelineRow({ sessionId, toolId }: { sessionId: string; toolId: string }) {
  const tool = useStore(sessionStores.ensure(sessionId), (state) => state.toolsById[toolId]);
  return tool === undefined ? null : <ToolCard tool={tool} />;
}
