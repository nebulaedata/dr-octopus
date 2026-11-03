/**
 * @author Codex
 * @description Presents organization and replay conversations with filters, metadata-only pagination and retained scroll position.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { HistoryIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Tabs, TabsList, TabsTrigger } from '@octopus/ui/components/tabs';
import { Badge } from '@octopus/ui/components/badge';
import { Separator } from '@octopus/ui/components/separator';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { Alert } from '@octopus/custom-ui/components/alert';
import { PopupListItem } from '../../components/PopupListItem';
import { PopupPage } from '../../components/PopupPage';
import { NavigationBar } from '../../components/NavigationBar';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import {
  skillError,
  type SkillHistoryPage,
  type SkillHistoryItem,
} from '../../lib/builtin-agent/skill-messages';
import { cn } from '@octopus/ui/lib/utils';
import { sessionStatus } from '../agent-session/session-status';

/**
 * Remains mounted when visiting a task, keeping loaded count and PopupPage's viewport position.
 */
export function ConversationList({
  visible,
  revision,
  onActive,
  open,
}: {
  visible: boolean;
  revision: string;
  onActive: (items: SkillHistoryItem[]) => void;
  open: (item: SkillHistoryItem) => void;
}) {
  const [page, setPage] = useState<SkillHistoryPage>({ items: [], total: 0, active: [] });
  const [filter, setFilter] = useState<'all' | 'organize' | 'replay'>('all');
  const previousFilter = useRef(filter);
  const mode = filter === 'all' ? undefined : filter;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadedCount = useRef(20);
  const generation = useRef(0);
  const paging = useRef(false);
  /**
   * Refreshes only the previously requested range; stale reads cannot replace a newer page or hidden view.
   */
  async function load(more = false) {
    if (more && paging.current) {
      return;
    }
    const version = ++generation.current;
    paging.current = true;
    setLoading(true);
    setError('');
    try {
      let next: SkillHistoryPage;
      if (more) {
        const tail = await skillRequest<SkillHistoryPage>({
          type: 'skill.history',
          mode,
          cursor: page.cursor,
        });
        const ids = new Set(page.items.map((job) => job.id));
        next = { ...tail, items: [...page.items, ...tail.items.filter((job) => !ids.has(job.id))] };
      } else {
        next = await skillRequest<SkillHistoryPage>({ type: 'skill.history', mode });
        while (next.cursor && next.items.length < loadedCount.current) {
          if (version !== generation.current) {
            return;
          }
          const tail = await skillRequest<SkillHistoryPage>({
            type: 'skill.history',
            mode,
            cursor: next.cursor,
          });
          const ids = new Set(next.items.map((job) => job.id));
          next = { ...tail, items: [...next.items, ...tail.items.filter((job) => !ids.has(job.id))] };
        }
      }
      if (version === generation.current) {
        loadedCount.current = Math.max(20, next.items.length);
        setPage(next);
        onActive(next.active ?? []);
      }
    } catch (failure) {
      if (version === generation.current) {
        setError(skillError(failure instanceof Error ? failure.message : ''));
      }
    } finally {
      if (version === generation.current) {
        paging.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (previousFilter.current !== filter) {
      previousFilter.current = filter;
      loadedCount.current = 20;
      setPage({ items: [], total: 0, active: [] });
    }
    void load();
    return () => {
      generation.current++;
      paging.current = false;
    };
  }, [filter, revision]);
  let loadLabel = '加载更多';
  if (loading) {
    loadLabel = '加载中…';
  } else if (error) {
    loadLabel = '重试加载';
  }
  return (
    <PopupPage
      visible={visible}
      scrollLabel="会话历史列表"
      scrollKey={filter}
      contentClassName="py-2"
      header={
        <>
          <NavigationBar title="会话历史" />
          <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <TabsList className="w-full">
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="organize">整理</TabsTrigger>
              <TabsTrigger value="replay">重放</TabsTrigger>
            </TabsList>
          </Tabs>
        </>
      }
      footer={
        <>
          {error && <Alert variant="danger" showIcon description={error} />}
          <p className="text-center text-xs text-muted-foreground">
            已加载 {page.items.length} 条 · 共 {page.total} 条
          </p>
          {(page.cursor || error) && (
            <Button variant="outline" disabled={loading} onClick={() => void load(!error)}>
              {loadLabel}
            </Button>
          )}
        </>
      }
    >
      {loading && !page.items.length && <Skeleton className="h-32" aria-label="正在加载会话历史" />}
      {!loading && !error && !page.items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>
              {filter === 'all' ? '暂无会话' : filter === 'organize' ? '暂无整理会话' : '暂无重放会话'}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <div className="flex flex-col gap-0">
        {page.items.map((job, index) => {
          const running = job.status === 'running';
          const presentation = sessionStatus[job.status];
          const Icon = presentation.icon;
          return (
            <Fragment key={job.id}>
              {index > 0 && <Separator className="my-2" />}
              <PopupListItem onClick={() => open(job)}>
                <Icon
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground',
                    running && 'animate-spin motion-reduce:animate-none',
                    job.status === 'completed' && 'text-success',
                    job.status === 'failed' && 'text-destructive'
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline">{job.mode === 'organize' ? '整理' : '重放'}</Badge>
                    <span className="truncate text-sm font-medium">{job.name ?? '录制名称未记录'}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {new Date(job.updatedAt).toLocaleString([], {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {job.model ?? '模型未记录'}
                    {job.retryOf ? ' · 重试' : ''}
                  </span>
                </span>
                <Badge variant={presentation.variant}>
                  {job.mode === 'replay' && job.status === 'completed' ? '已结束' : presentation.label}
                </Badge>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </PopupListItem>
            </Fragment>
          );
        })}
      </div>
    </PopupPage>
  );
}
