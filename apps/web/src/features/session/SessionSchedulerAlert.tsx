/**
 * @author Codex
 * @description Shows unread Scheduler summaries and navigable results in their originating conversation.
 */
import { formatDateTime } from '@/utils/date';
import { useState } from 'react';
import { CalendarClockIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { Button } from '@octopus/ui/components/button';
import { getNotifications } from '@/api/notifications';
import { useI18n } from '@/i18n/use-i18n';
import { SessionReadReceipt } from './SessionReadReceipt';
import { cn } from '@octopus/ui/lib/utils';
import type { SessionDto } from '@octopus/shared/protocol';
/**
 * Display unread result links until their result Sessions are acknowledged or locally dismissed.
 */
export function SessionSchedulerAlert({ session, ready }: { session: SessionDto; ready: boolean }) {
  const { t } = useI18n();
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => new Set());
  const query = useQuery({
    queryKey: ['notifications', 'source', session.id],
    queryFn: ({ signal }) => getNotifications(0, session.id, signal),
  });
  const items =
    query.data?.items.filter(
      (notice) =>
        notice.unread && notice.runId && notice.originSessionId === session.id && !dismissedIds.has(notice.id)
    ) ?? [];
  return (
    <>
      <SessionReadReceipt session={session} ready={ready && query.isSuccess} />
      {items.length > 0 && (
        <Collapsible
          className={cn(
            'pointer-events-auto overflow-hidden rounded-xl border bg-background shadow-lg shadow-black/5 dark:shadow-white/5',
            'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-50'
          )}
        >
          <div className="flex items-center gap-1 p-2">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  className="hover:bg-sky-100 dark:hover:bg-sky-900 aria-expanded:bg-sky-100 dark:aria-expanded:bg-sky-900"
                />
              }
              className="group h-12 min-w-0 flex-1 justify-between gap-3 px-4"
            >
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                <CalendarClockIcon />
                <span className="truncate">
                  {t('session.schedulerAlert.title', 'Scheduled task results (latest {{count}})', {
                    count: items.length,
                  })}
                </span>
              </div>
              <ChevronDownIcon className="transition-transform group-aria-expanded:rotate-180 text-muted-foreground" />
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss scheduled task notifications"
              className="shrink-0"
              onClick={() =>
                setDismissedIds((previous) => new Set([...previous, ...items.map((notice) => notice.id)]))
              }
            >
              <XIcon />
            </Button>
          </div>
          <CollapsibleContent>
            <div className="flex max-h-52 flex-col gap-3 overflow-y-auto overscroll-contain border-t px-6 py-4">
              {items.map((notice) => (
                <div key={notice.id}>
                  <Link
                    to="/workspaces/$workspaceId/sessions/$sessionId"
                    params={{ workspaceId: notice.workspaceId, sessionId: notice.sessionId }}
                    className="text-sm underline wrap-anywhere"
                  >
                    {notice.title}
                    {' · '}
                    {formatDateTime(notice.createdAt)}
                    {' · '}
                    {t('session.schedulerAlert.viewResult', 'View result')}
                  </Link>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{notice.summary}</p>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}
