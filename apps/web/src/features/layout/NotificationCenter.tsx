/**
 * @author Codex
 * @description Provides a global, paginated inbox linking durable results to their Sessions.
 */
import { formatDateTime } from '@/utils/date';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellIcon, CheckCheckIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { Badge } from '@octopus/ui/components/badge';
import { ScrollArea } from '@octopus/ui/components/scroll-area';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@octopus/ui/components/item';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@octopus/ui/components/empty';
import { getNotifications, markAllNotificationsRead } from '@/api/notifications';
import { ScheduleRunStatusBadge } from '@/features/schedules/ScheduleRunStatusBadge';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Show unread count across workspaces without changing the selected Session.
 */
export function NotificationCenter() {
  const { t } = useI18n();
  const statusLabels: Record<string, string> = {
    succeeded: t('layout.notifications.status.succeeded', 'Completed'),
    failed: t('layout.notifications.status.failed', 'Failed'),
    needs_attention: t('layout.notifications.status.needsAttention', 'Needs attention'),
    timed_out: t('layout.notifications.status.timedOut', 'Timed out'),
    cancelled: t('layout.notifications.status.cancelled', 'Cancelled'),
    interrupted: t('layout.notifications.status.interrupted', 'Interrupted'),
    skipped: t('layout.notifications.status.skipped', 'Skipped'),
  };
  const queryClient = useQueryClient();
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      ]),
  });
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const inbox = useQuery({
    queryKey: ['notifications', 'inbox', offset],
    queryFn: ({ signal }) => getNotifications(offset, undefined, signal),
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative ml-2"
        aria-label={`Notifications, ${inbox.data?.unreadCount ?? 0} unread`}
        onClick={() => {
          setOffset(0);
          setOpen(true);
        }}
      >
        <BellIcon />
        {!!inbox.data?.unreadCount && (
          <span aria-hidden="true" className="absolute right-1 top-1 size-2 rounded-full bg-blue-500" />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(640px,85dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="shrink-0 px-5 pb-4 pt-5 sm:px-6">
            <div className="flex items-center gap-2 pr-6">
              <DialogTitle>{t('layout.notifications.title', 'Notifications')}</DialogTitle>
              {!!inbox.data?.unreadCount && (
                <Badge variant="secondary">
                  {t('layout.notifications.unreadBadge', '{{unread}} unread', { unread: inbox.data.unreadCount })}
                </Badge>
              )}
            </div>
            <DialogDescription>
              {t('layout.notifications.description', 'Task results and pending items')}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea
            key={offset}
            aria-label="Notification list"
            className="min-h-0 flex-1 border-y"
          >
            <div className="px-2 py-2 sm:px-3">
              {inbox.isPending && (
                <p role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {t('layout.notifications.loading', 'Loading notifications…')}
                </p>
              )}
              {inbox.error && (
                <p role="alert" className="px-3 py-8 text-sm text-destructive">
                  {inbox.error.message}
                </p>
              )}
              {inbox.data?.items.length === 0 && (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BellIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t('layout.notifications.emptyTitle', 'No notifications')}</EmptyTitle>
                    <EmptyDescription>
                      {t(
                        'layout.notifications.emptyDescription',
                        'You will be notified here when tasks complete or need attention.'
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              <ItemGroup className="gap-0">
                {inbox.data?.items.map((notice, index) => (
                  <Fragment key={notice.id}>
                    {index > 0 && <ItemSeparator className="my-1" />}
                    <Item
                      className="items-start px-3 py-4"
                      render={
                        <Link
                          to="/workspaces/$workspaceId/sessions/$sessionId"
                          params={{ workspaceId: notice.workspaceId, sessionId: notice.sessionId }}
                          onClick={() => setOpen(false)}
                        />
                      }
                    >
                      <ItemContent className="min-w-0 gap-2">
                        <div className="flex items-start gap-2">
                          <ItemTitle className="min-w-0 flex-1">
                            <span className="line-clamp-2 wrap-break-word">{notice.title}</span>
                          </ItemTitle>
                          {notice.unread && (
                            <span
                              role="img"
                              aria-label="Unread messages"
                              className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500"
                            />
                          )}
                        </div>
                        <ItemDescription className="whitespace-pre-wrap wrap-break-word">
                          {notice.summary}
                        </ItemDescription>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <ScheduleRunStatusBadge
                            status={notice.status}
                            label={statusLabels[notice.status] ?? notice.status}
                          />
                          <time
                            dateTime={notice.createdAt}
                            className="text-xs tabular-nums text-muted-foreground"
                          >
                            {formatDateTime(notice.createdAt, t('layout.notifications.dateFormat', 'MMM D, HH:mm'))}
                          </time>
                        </div>
                      </ItemContent>
                    </Item>
                  </Fragment>
                ))}
              </ItemGroup>
            </div>
          </ScrollArea>
          {markAllRead.error && (
            <p role="alert" className="px-5 py-2 text-sm text-destructive">
              {markAllRead.error.message}
            </p>
          )}
          <DialogFooter className="m-0 shrink-0 flex-row flex-wrap items-center justify-between border-0 px-5 py-3 sm:justify-between sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              disabled={!inbox.data?.unreadCount || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheckIcon data-icon="inline-start" />
              {t('layout.notifications.markAllRead', 'Mark all read')}
            </Button>
            <ListPagination
              aria-label="Notification pagination"
              className="w-auto"
              compact
              page={offset / 20 + 1}
              hasNextPage={Boolean(inbox.data?.hasMore)}
              disabled={inbox.isFetching}
              onPageChange={(page) => setOffset((page - 1) * 20)}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
