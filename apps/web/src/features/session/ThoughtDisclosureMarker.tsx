/**
 * @author Codex
 * @description Renders the shared expandable Thinking and completed Thought states for one assistant message.
 */

import { BrainCircuitIcon, ChevronRightIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { Marker, MarkerContent, MarkerIcon } from '@octopus/ui/components/marker';
import { cn } from '@octopus/ui/lib/utils';
import { formatDuration } from '@octopus/custom-ui/components/elapsed-time';
import { useI18n } from '@/i18n/use-i18n';

export interface ThoughtDisclosureMarkerProps {
  endedAt?: number;
  isThinking: boolean;
  startedAt?: number;
  text: string;
}

/**
 * Formats a completed reasoning interval for the compact disclosure label.
 *
 * @param startedAt - Reasoning start time in milliseconds.
 * @param endedAt - Reasoning end time in milliseconds.
 * @returns A whole-second duration, with a one-second minimum for visible work.
 */
function formatThoughtDuration(
  startedAt: number | undefined,
  endedAt: number | undefined
): string | undefined {
  if (startedAt === undefined || endedAt === undefined) {
    return undefined;
  }
  return formatDuration(Math.max(0, endedAt - startedAt), 'compact');
}

/**
 * Presents reasoning through one accessible disclosure in both active and completed states.
 */
export function ThoughtDisclosureMarker({
  endedAt,
  isThinking,
  startedAt,
  text,
}: ThoughtDisclosureMarkerProps) {
  const { t } = useI18n();
  const duration = formatThoughtDuration(startedAt, endedAt);
  let label: string;
  if (isThinking) {
    label = t('session.thoughtDisclosure.thinking', 'Thinking…');
  } else if (duration === undefined) {
    label = t('session.thoughtDisclosure.thought', 'Thought');
  } else {
    label = t('session.thoughtDisclosure.thoughtFor', 'Thought for {{duration}}', { duration });
  }
  return (
    <Collapsible>
      <CollapsibleTrigger
        aria-label={`${label}. Expand reasoning`}
        className={cn(
          'group/thought flex items-center gap-1 text-xs font-medium text-muted-foreground my-2',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <Marker role="status">
          <MarkerIcon>
            <BrainCircuitIcon />
          </MarkerIcon>
          <MarkerContent className={cn(isThinking && 'shimmer')}>
            <span className="text-xs font-geist">{label}</span>
          </MarkerContent>
          <MarkerIcon>
            <ChevronRightIcon className="transition-transform group-data-panel-open/thought:rotate-90" />
          </MarkerIcon>
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-l pl-4">
        {text.length > 0 ? (
          <MarkdownRenderer className="text-muted-foreground!">{text}</MarkdownRenderer>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t('session.thoughtDisclosure.waiting', 'Waiting for reasoning…')}
          </span>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
