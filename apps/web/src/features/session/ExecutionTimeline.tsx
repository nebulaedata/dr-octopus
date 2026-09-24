/**
 * @author Codex
 * @description Presents retained execution messages in order while hiding empty and duplicate prompt entries.
 */
import { FileTextIcon, MessageSquareIcon, TerminalIcon, WrenchIcon } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@octopus/ui/components/empty';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Timeline, TimelineItem } from '@/components/Timeline';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Keep text responses readable and disclose verbose tool records on demand.
 */
export function ExecutionTimeline({
  items,
  prompt,
}: {
  items: { id: string; role: string; text: string }[];
  prompt: string;
}) {
  const { t } = useI18n();
  const entries = items.filter(
    (entry) => entry.text.trim() && !(entry.role === 'user' && entry.text.trim() === prompt.trim())
  );
  if (!entries.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('session.executionTimeline.emptyTitle', 'No execution content yet')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'session.executionTimeline.emptyDescription',
              'No execution messages to display on this page; check the run status or switch records.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Timeline aria-label="Execution timeline">
      {entries.map((entry) => {
        const toolCall = entry.role === 'toolCall';
        const toolResult = entry.role === 'toolResult';
        let title: string;
        if (toolCall) {
          title = t('session.executionTimeline.toolCall', 'Tool call');
        } else if (toolResult) {
          title = t('session.executionTimeline.toolResult', 'Tool result');
        } else if (entry.role === 'assistant') {
          title = t('session.executionTimeline.assistant', 'Assistant reply');
        } else if (entry.role === 'user') {
          title = t('session.executionTimeline.user', 'Additional instructions');
        } else {
          title = t('session.executionTimeline.fallback', 'Run note');
        }
        /**
         * Selects icon in the existing condition order.
         */
        function selectIcon() {
          if (toolCall) {
            return <WrenchIcon />;
          } else if (toolResult) {
            return <TerminalIcon />;
          } else if (entry.role === 'assistant') {
            return <MessageSquareIcon />;
          } else {
            return <FileTextIcon />;
          }
        }
        return (
          <TimelineItem key={entry.id} title={title} collapsible={toolCall || toolResult} icon={selectIcon()}>
            {toolCall || toolResult ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-6 [overflow-wrap:anywhere]">
                {entry.text}
              </pre>
            ) : (
              <MarkdownRenderer className="min-w-0 [overflow-wrap:anywhere]">{entry.text}</MarkdownRenderer>
            )}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
