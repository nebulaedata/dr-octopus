/**
 * @author Codex
 * @description Minimal line mini-map of user questions inside the conversation area.
 */

import { copyTextWithFeedback } from '@/lib/copy-text-with-feedback';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useMessageScroller, useMessageScrollerVisibility } from '@octopus/ui/components/message-scroller';
import { Button } from '@octopus/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { sessionStores } from '@/stores/session';
import { cn } from '@octopus/ui/lib/utils';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useI18n } from '@/i18n/use-i18n';
import { makePopoverMarkdown, makeTooltipLabel } from './mini-map-utils';
import type { MessageProjection } from '@/stores/session';

export interface ConversationMiniMapProps {
  sessionId: string;
  className?: string;
}

/**
 * Delay before the preview panel commits to a newly hovered question.
 * Prevents expensive Markdown re-renders while the cursor is still moving.
 */
const PREVIEW_STABLE_DELAY_MS = 150;

/**
 * Delay before the hover state is cleared after the cursor leaves.
 */
const HOVER_LEAVE_DELAY_MS = 120;

/**
 * Renders a minimal vertical line map of user questions inside the conversation scroller.
 *
 * @param sessionId - The active Session identifier used to subscribe to message projections.
 * @param className - Optional root class override.
 */
export function ConversationMiniMap({ sessionId, className }: ConversationMiniMapProps) {
  const store = sessionStores.ensure(sessionId);
  const messageIds = useStore(store, (state) => state.messageIds);
  const messagesById = useStore(store, (state) => state.messagesById);
  const { scrollToMessage } = useMessageScroller();
  const { visibleMessageIds } = useMessageScrollerVisibility();

  const questions = deriveQuestions(messageIds, messagesById);
  const activeId = deriveActiveQuestionId(messageIds, messagesById, visibleMessageIds);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [stableIndex, setStableIndex] = useState<number | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHover = (index: number | null) => {
    if (leaveTimeoutRef.current !== null) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (index !== null) {
      setHoveredIndex(index);
      return;
    }
    leaveTimeoutRef.current = setTimeout(() => {
      setHoveredIndex(null);
      leaveTimeoutRef.current = null;
    }, HOVER_LEAVE_DELAY_MS);
  };

  useEffect(() => {
    if (stableTimeoutRef.current !== null) {
      clearTimeout(stableTimeoutRef.current);
    }
    if (hoveredIndex === null) {
      stableTimeoutRef.current = setTimeout(() => {
        setStableIndex(null);
        stableTimeoutRef.current = null;
      }, HOVER_LEAVE_DELAY_MS);
    } else {
      stableTimeoutRef.current = setTimeout(() => {
        setStableIndex(hoveredIndex);
        stableTimeoutRef.current = null;
      }, PREVIEW_STABLE_DELAY_MS);
    }
    return () => {
      if (stableTimeoutRef.current !== null) {
        clearTimeout(stableTimeoutRef.current);
      }
    };
  }, [hoveredIndex]);

  useEffect(() => {
    return () => {
      if (leaveTimeoutRef.current !== null) {
        clearTimeout(leaveTimeoutRef.current);
      }
      if (stableTimeoutRef.current !== null) {
        clearTimeout(stableTimeoutRef.current);
      }
    };
  }, []);

  if (questions.length === 0) {
    return null;
  }

  const stableMessage = stableIndex !== null ? questions[stableIndex] : null;

  return (
    <aside
      aria-label="Conversation mini-map"
      className={cn(
        'pointer-events-none absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col xl:flex',
        className
      )}
    >
      <PreviewPanel
        message={stableMessage}
        questionNumber={stableIndex !== null ? stableIndex + 1 : null}
        isVisible={hoveredIndex !== null || stableIndex !== null}
        onMouseEnter={() => {
          if (stableIndex !== null) {
            handleHover(stableIndex);
          }
        }}
        onMouseLeave={() => handleHover(null)}
      />
      <div className="flex w-12 flex-col items-end">
        {questions.map((message, index) => (
          <LineAnchor
            key={message.id}
            index={index}
            message={message}
            isActive={activeId === message.id}
            hoveredIndex={hoveredIndex}
            onHover={handleHover}
            onActivate={() =>
              scrollToMessage(message.id, {
                align: 'start',
                behavior: 'smooth',
                scrollMargin: 16,
              })
            }
          />
        ))}
      </div>
    </aside>
  );
}

interface PreviewPanelProps {
  message: MessageProjection | null;
  questionNumber: number | null;
  isVisible: boolean;
  onMouseEnter(): void;
  onMouseLeave(): void;
}

/**
 * Single fixed-position preview panel anchored to the left of the mini-map.
 * Content is rendered lazily once the hover target has stabilized.
 */
function PreviewPanel({ message, questionNumber, isVisible, onMouseEnter, onMouseLeave }: PreviewPanelProps) {
  const { t } = useI18n();
  const preview = message !== null ? makePopoverMarkdown(message) : '';

  return (
    <div
      className={cn(
        'pointer-events-auto absolute right-full top-1/2 mr-3 w-72 -translate-y-1/2 overflow-hidden rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-md transition-all duration-200 ease-out',
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0 pointer-events-none'
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {message !== null && questionNumber !== null && (
        <>
          <div
            aria-label="header"
            className="flex items-center justify-between border-b border-border px-3 py-2"
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t('session.miniMap.questionNumber', 'Question {{number}}', { number: questionNumber })}
            </span>
            <CopyPreviewButton text={preview} />
          </div>
          <div aria-label="content" className="max-h-64 overflow-y-auto p-3">
            <MarkdownRenderer className="max-w-none text-sm">{preview}</MarkdownRenderer>
          </div>
        </>
      )}
    </div>
  );
}

interface CopyPreviewButtonProps {
  text: string;
}

/**
 * Renders a copy button that writes the preview markdown to the clipboard.
 *
 * @param text - The preview content to copy.
 */
function CopyPreviewButton({ text }: CopyPreviewButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /**
   * Copies the preview text to the system clipboard.
   */
  const handleCopy = async (): Promise<void> => {
    setCopied(await copyTextWithFeedback(text));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={copied ? 'Copied' : 'Copy title'}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        }
      />
      <TooltipContent>
        {copied
          ? t('session.messageToolbar.copied', 'Copied')
          : t('session.miniMap.copyTitle', 'Copy title')}
      </TooltipContent>
    </Tooltip>
  );
}

interface LineAnchorProps {
  index: number;
  message: MessageProjection;
  isActive: boolean;
  hoveredIndex: number | null;
  onHover(index: number | null): void;
  onActivate(): void;
}

/**
 * Renders one thin line anchor with a pyramid hover halo.
 */
function LineAnchor({ index, message, isActive, hoveredIndex, onHover, onActivate }: LineAnchorProps) {
  const questionNumber = index + 1;
  const tooltip = makeTooltipLabel(message);
  const distance = hoveredIndex === null ? Infinity : Math.abs(index - hoveredIndex);

  const lineWidthClass = distance === 0 ? 'w-9' : distance === 1 ? 'w-7' : distance === 2 ? 'w-6' : 'w-5';

  const lineOpacityClass =
    distance === 0
      ? 'bg-muted-foreground/80'
      : distance === 1
        ? 'bg-muted-foreground/60'
        : distance === 2
          ? 'bg-muted-foreground/45'
          : 'bg-muted-foreground/30';

  return (
    <button
      type="button"
      aria-label={`Jump to question ${questionNumber}: ${tooltip}`}
      aria-current={isActive ? 'true' : undefined}
      onClick={onActivate}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      className="group pointer-events-auto flex cursor-pointer items-center justify-end px-1.5 py-1 focus:outline-none"
    >
      <span
        className={cn(
          'block h-0.5 rounded-full transition-all duration-200 ease-out',
          lineWidthClass,
          lineOpacityClass,
          isActive && 'bg-primary'
        )}
      />
    </button>
  );
}

/**
 * Derives the ordered list of user messages from the projection store.
 *
 * @param messageIds - Ordered message identifiers.
 * @param messagesById - Message lookup table.
 * @returns User messages in transcript order.
 */
function deriveQuestions(
  messageIds: string[],
  messagesById: Record<string, MessageProjection>
): MessageProjection[] {
  const questions: MessageProjection[] = [];
  for (const id of messageIds) {
    const message = messagesById[id];
    if (message?.role === 'user') {
      questions.push(message);
    }
  }
  return questions;
}

/**
 * Derives the active question id from the topmost visible transcript row.
 *
 * @param messageIds - Ordered message identifiers.
 * @param messagesById - Message lookup table.
 * @param visibleMessageIds - Currently visible message identifiers from the scroller.
 * @returns The nearest preceding user message id, or undefined.
 */
function deriveActiveQuestionId(
  messageIds: string[],
  messagesById: Record<string, MessageProjection>,
  visibleMessageIds: string[]
): string | undefined {
  const topVisible = visibleMessageIds[0];
  const topIndex = topVisible === undefined ? -1 : messageIds.indexOf(topVisible);
  const startIndex = topIndex === -1 ? messageIds.length - 1 : topIndex;
  for (let index = startIndex; index >= 0; index -= 1) {
    const message = messagesById[messageIds[index]];
    if (message?.role === 'user') {
      return message.id;
    }
  }
  return undefined;
}
