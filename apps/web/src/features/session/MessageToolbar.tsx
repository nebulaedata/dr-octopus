/**
 * @author Codex
 * @description Presents per-message actions: copy text, fork from this history entry, and thumbs up/down.
 */

import { copyTextWithFeedback } from '@/lib/copy-text-with-feedback';
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, GitForkIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { useForkSessionFromEntry, useSubmitMessageFeedback } from '@/queries/session-queries';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { cn } from '@octopus/ui/lib/utils';
import type { MessageProjection } from '@/stores/session';
import type { SessionDto } from '@octopus/shared/protocol';

export interface MessageToolbarProps {
  session: SessionDto;
  message: MessageProjection;
}

/**
 * Extracts the human-readable text from a message's content blocks.
 *
 * @param content - Normalized content blocks.
 * @returns Joined text and thinking blocks.
 */
function extractMessageText(content: MessageProjection['content']): string {
  return content
    .filter((block): block is Extract<MessageProjection['content'][number], { type: 'text' | 'thinking' }> => block.type === 'text' || block.type === 'thinking')
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * Renders a compact action bar for one chat message.
 */
export function MessageToolbar({ session, message }: MessageToolbarProps) {
  const { t } = useI18n();
  const store = sessionStores.ensure(session.id);
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const text = extractMessageText(message.content);
  const canCopy = text !== '';
  const canFork = message.entryId !== undefined && message.role === 'user';
  const canRate = message.entryId !== undefined && message.role !== 'user';
  const fork = useForkSessionFromEntry(session);
  const feedback = useSubmitMessageFeedback(session);

  useEffect(() => {
    if (fork.data?.session === undefined) {
      return;
    }
    void navigate({
      to: '/workspaces/$workspaceId/sessions/$sessionId',
      params: { workspaceId: fork.data.session.workspaceId, sessionId: fork.data.session.id },
      search: (previous) => previous,
    });
  }, [fork.data, navigate]);

  useEffect(() => {
    if (fork.error !== null) {
      store.getState().setError(fork.error.message);
    }
  }, [fork.error, store]);

  useEffect(() => {
    if (feedback.error !== null) {
      store.getState().setError(feedback.error.message);
    }
  }, [feedback.error, store]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /**
   * Copies the message text to the system clipboard.
   */
  const handleCopy = async (): Promise<void> => {
    if (!canCopy) {
      return;
    }
    setCopied(await copyTextWithFeedback(text));
  };

  /**
   * Forks a new Session from this message's history entry.
   */
  const handleFork = (): void => {
    if (!canFork || message.entryId === undefined) {
      return;
    }
    fork.mutate(message.entryId);
  };

  /**
   * Submits or switches thumbs-up/thumbs-down feedback.
   */
  const handleFeedback = (rating: 'up' | 'down'): void => {
    if (!canRate || message.entryId === undefined || message.feedback === rating) {
      return;
    }
    feedback.mutate({ entryId: message.entryId, rating });
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1 opacity-0 transition-opacity',
        'group-hover/message:opacity-100 focus-within:opacity-100'
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={copied ? 'Copied' : 'Copy message'}
              disabled={!canCopy}
              onClick={handleCopy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          }
        />
        <TooltipContent>
          {copied
            ? t('session.messageToolbar.copied', 'Copied')
            : t('session.messageToolbar.copyMessage', 'Copy message')}
        </TooltipContent>
      </Tooltip>

      {message.role === 'user' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Fork session from this message"
                disabled={!canFork || fork.isPending}
                onClick={handleFork}
              >
                <GitForkIcon />
              </Button>
            }
          />
          <TooltipContent>{t('session.messageToolbar.fork', 'Fork session from this message')}</TooltipContent>
        </Tooltip>
      )}

      {message.role !== 'user' && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Thumbs up"
                  aria-pressed={message.feedback === 'up'}
                  disabled={!canRate || feedback.isPending}
                  onClick={() => handleFeedback('up')}
                  className={cn(message.feedback === 'up' && 'text-primary')}
                >
                  <ThumbsUpIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.messageToolbar.goodResponse', 'Good response')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Thumbs down"
                  aria-pressed={message.feedback === 'down'}
                  disabled={!canRate || feedback.isPending}
                  onClick={() => handleFeedback('down')}
                  className={cn(message.feedback === 'down' && 'text-primary')}
                >
                  <ThumbsDownIcon />
                </Button>
              }
            />
            <TooltipContent>{t('session.messageToolbar.badResponse', 'Bad response')}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
