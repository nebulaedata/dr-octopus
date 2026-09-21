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
        const title = toolCall
          ? t('session.executionTimeline.toolCall', 'Tool call')
          : toolResult
            ? t('session.executionTimeline.toolResult', 'Tool result')
            : entry.role === 'assistant'
              ? t('session.executionTimeline.assistant', 'Assistant reply')
              : entry.role === 'user'
                ? t('session.executionTimeline.user', 'Additional instructions')
                : t('session.executionTimeline.fallback', 'Run note');
        return (
          <TimelineItem
            key={entry.id}
            title={title}
            collapsible={toolCall || toolResult}
            icon={
              toolCall ? (
                <WrenchIcon />
              ) : toolResult ? (
                <TerminalIcon />
              ) : entry.role === 'assistant' ? (
                <MessageSquareIcon />
              ) : (
                <FileTextIcon />
              )
            }
          >
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
