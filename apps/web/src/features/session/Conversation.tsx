/**
 * @author Codex
 * @description Projects normalized Session messages and tool executions into the conversation transcript.
 */

import { Fragment, useEffect } from 'react';
import { MessageSquareDashedIcon } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { MessageSkeleton } from '@/components/MessageSkeleton';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@octopus/ui/components/message-scroller';
import { sessionStores } from '@/stores/session';
import { useI18n } from '@/i18n/use-i18n';
import { ConversationMiniMap } from './ConversationMiniMap';
import { CompactionMarker } from './CompactionMarker';
import { ExtensionNotificationRow } from './ExtensionNotificationRow';
import { MessageView } from './MessageView';
import { MessageRow } from './MessageRow';
import { RetryMarker } from './RetryMarker';
import { ToolTimeline } from './ToolTimeline';
import { TurnDurationMarker } from './TurnDurationMarker';
import { groupTranscriptRows, selectVisibleTranscriptMessageIds } from './utils/transcript-layout';
import type { TranscriptItem } from '@/stores/session';
import type { SessionDto, ConversationStartDto } from '@octopus/shared/protocol';

/**
 * Subscribes only to ordered projection identifiers so row updates remain local.
 */
export function Conversation({
  loading = false,
  savedMessage,
  session,
  sessionId,
}: {
  loading?: boolean;
  savedMessage?: ConversationStartDto | null;
  session: SessionDto;
  sessionId: string;
}) {
  const store = sessionStores.ensure(sessionId);
  const { t } = useI18n();
  const transcriptItems = useStore(store, (state) => state.transcriptItems);
  const hydrated = useStore(store, (state) => state.hydrated);
  const historyLoaded = useStore(store, (state) => state.historyLoaded);
  const isLoading = !historyLoaded && (loading || (!hydrated && transcriptItems.length === 0));
  /**
   * Selects message scroller content content in the existing condition order.
   */
  function renderTranscriptContent() {
    if (
      savedMessage &&
      transcriptItems.length === 0 &&
      (savedMessage.status !== 'running' || !historyLoaded || loading)
    ) {
      return (
        <MessageScrollerItem messageId={`start:${sessionId}`}>
          <MessageView
            session={session}
            message={{
              id: `start:${sessionId}`,
              role: 'user',
              content: [{ type: 'text', text: savedMessage.message }],
            }}
          />
        </MessageScrollerItem>
      );
    } else if (isLoading) {
      return <MessageSkeleton />;
    } else {
      return (
        <>
          {transcriptItems.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareDashedIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {loading
                    ? t('session.conversation.emptyTitleLoading', 'No earlier messages yet')
                    : t('session.conversation.emptyTitle', 'Ready when you are')}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    'session.conversation.emptyDescription',
                    'Ask about this workspace, attach an image, or run a discovered command.'
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <TranscriptRows items={transcriptItems} session={session} sessionId={sessionId} />
            </>
          )}
        </>
      );
    }
  }
  return (
    <MessageScrollerProvider
      key={`${sessionId}:${isLoading ? 'loading' : 'ready'}`}
      autoScroll
      defaultScrollPosition="end"
    >
      <SubmittedMessageScroll sessionId={sessionId} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-4xl px-5 pt-20 pb-8 sm:px-8">
            {renderTranscriptContent()}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        <ConversationMiniMap sessionId={sessionId} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * Interleaves transcript rows with duration markers owned by explicit Turn projections.
 *
 * @param props - Ordered transcript identities and Session context.
 * @returns Transcript rows with one duration marker after each Turn's final owned item.
 */
function TranscriptRows({
  items,
  session,
  sessionId,
}: {
  items: TranscriptItem[];
  session: SessionDto;
  sessionId: string;
}) {
  const visibleMessageIds = useStore(
    sessionStores.ensure(sessionId),
    useShallow(selectVisibleTranscriptMessageIds)
  );
  return groupTranscriptRows(items, visibleMessageIds).map((row) => {
    if (row.type === 'tools') {
      return <ToolTimeline key={`tools:${row.id}`} sessionId={sessionId} toolIds={row.toolIds} />;
    }
    if (row.type === 'turn-end') {
      return (
        <Fragment key={`end:${row.turnId}`}>
          <RetryMarker sessionId={sessionId} turnId={row.turnId} />
          <TurnDurationMarker sessionId={sessionId} turnId={row.turnId} />
        </Fragment>
      );
    }
    return renderTranscriptRow(row.item, session, sessionId);
  });
}

/**
 * Renders one normalized transcript identity without subscribing the transcript shell to row state.
 *
 * @param item - Ordered transcript identity.
 * @param session - Session metadata used by message actions.
 * @param sessionId - Browser Session identity.
 * @returns The specialized transcript row.
 */
function renderTranscriptRow(
  item: Exclude<TranscriptItem, { type: 'tool' }>,
  session: SessionDto,
  sessionId: string
) {
  if (item.type === 'message') {
    return (
      <MessageRow
        key={`message:${item.id}`}
        session={session}
        sessionId={sessionId}
        messageId={item.id}
        turnId={item.turnId}
      />
    );
  }
  if (item.type === 'notification') {
    return (
      <ExtensionNotificationRow
        key={`notification:${item.id}`}
        notificationId={item.id}
        sessionId={sessionId}
      />
    );
  }
  return <CompactionMarker key={`compaction:${item.id}`} compactionId={item.id} sessionId={sessionId} />;
}

/**
 * Moves a manually detached transcript back into follow mode when this browser submits a new message.
 */
function SubmittedMessageScroll({ sessionId }: { sessionId: string }) {
  const store = sessionStores.ensure(sessionId);
  const latestRequestId = useStore(store, (state) => {
    for (let index = state.messageIds.length - 1; index >= 0; index -= 1) {
      const message = state.messagesById[state.messageIds[index]];
      if (message?.role === 'user' && message.correlationRequestId !== undefined) {
        return message.correlationRequestId;
      }
    }
    return undefined;
  });
  const { scrollToEnd } = useMessageScroller();
  useEffect(() => {
    if (latestRequestId === undefined) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollToEnd({ behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestRequestId, scrollToEnd]);
  return null;
}
