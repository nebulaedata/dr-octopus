/**
 * @author Codex
 * @description Owns searchable cursor pages and preserves their scroll position while a record detail is open.
 */
import { Alert } from '@octopus/custom-ui/components/alert';
import { Fragment, useEffect, useRef, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@octopus/ui/components/input-group';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { PopupPage } from '../../components/PopupPage';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyContent } from '@octopus/ui/components/empty';
import { NavigationBar } from '../../components/NavigationBar';
import { Separator } from '@octopus/ui/components/separator';
import { RecordingRow } from './RecordingRow';
import type { RecordingSkillState } from '../../lib/builtin-agent/skill-messages';
import { sendRecordingRequest } from '../../lib/recording/recording-client';
import {
  recordingError,
  type RecordingCursor,
  type RecordingListPage,
  type RecordingSummary,
} from '../../lib/recording/recording-contract';

export type RecordingListChange = { id: string; name: string } | { id: string; removed: true };

/**
 * Loads the complete stored range in twenty-record pages without binding search to the loaded subset.
 */
export function RecordingList({
  back,
  open,
  change,
  visible,
  skillStates,
}: {
  visible: boolean;
  back: () => void;
  open: (id: string) => void;
  change: RecordingListChange | null;
  skillStates: Record<string, RecordingSkillState>;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<RecordingSummary[]>([]);
  const [cursor, setCursor] = useState<RecordingCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  /**
   * Appends only a matching request generation; late old searches cannot replace a new result set.
   */
  async function load(search: string, after: RecordingCursor | null, requestGeneration: number) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await sendRecordingRequest<RecordingListPage>({
        type: 'recorder.list',
        query: search,
        cursor: after,
      });
      if (!mounted.current || requestGeneration !== generation.current) {
        return;
      }
      setItems((previous) => {
        if (!after) {
          return result.items;
        }
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !known.has(item.id))];
      });
      setCursor(result.nextCursor);
    } catch (failure) {
      if (mounted.current && requestGeneration === generation.current) {
        setError(recordingError(failure instanceof Error ? failure.message : 'RECORDING_DELIVERY'));
      }
    } finally {
      if (requestGeneration === generation.current) {
        inFlight.current = false;
        if (mounted.current) {
          setLoading(false);
        }
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    const requestGeneration = ++generation.current;
    inFlight.current = false;
    const timer = setTimeout(
      () => {
        void load(query, null, requestGeneration);
      },
      query ? 200 : 0
    );
    return () => {
      clearTimeout(timer);
      generation.current++;
      mounted.current = false;
    };
  }, [query]);

  useEffect(() => {
    if (!change) {
      return;
    }
    setItems((previous) =>
      previous.flatMap((item) => {
        if (item.id !== change.id) {
          return [item];
        }
        if ('removed' in change) {
          return [];
        }
        if (
          !change.name.normalize('NFKC').toLowerCase().includes(query.trim().normalize('NFKC').toLowerCase())
        ) {
          return [];
        }
        return [{ ...item, name: change.name }];
      })
    );
  }, [change, query]);

  /**
   * Invalidates old reads immediately; PopupPage resets its viewport when the search key changes.
   */
  function search(value: string) {
    generation.current++;
    inFlight.current = false;
    setQuery(value);
    setItems([]);
    setCursor(null);
    setLoading(true);
    setError('');
  }

  return (
    <PopupPage
      scrollLabel="录制记录列表"
      contentClassName="py-2"
      visible={visible}
      scrollKey={query}
      header={
        <>
          <NavigationBar title="全部记录" onBack={back} backLabel="返回录制首页" />
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索全部录制"
              placeholder="搜索全部录制"
              maxLength={80}
              value={query}
              onChange={(event) => search(event.target.value)}
            />
          </InputGroup>
        </>
      }
      footer={
        (error || items.length > 0 || cursor) && (
          <div className="flex shrink-0 flex-col gap-2">
            {error && <Alert variant="danger" showIcon description={error} />}
            {items.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">已加载 {items.length} 条</p>
            )}
            {(cursor || error) && (
              <Button
                disabled={loading}
                onClick={() => {
                  void load(query, cursor, generation.current);
                }}
              >
                {error ? '重试加载' : '加载更多'}
              </Button>
            )}
          </div>
        )
      }
    >
      {loading && !items.length && <Skeleton className="h-32 w-full" aria-label="正在加载记录" />}
      {items.length > 0 && (
        <div className="flex flex-col gap-0">
          {items.map((item, index) => {
            const heading = dateHeading(item.startedAt);
            const previousHeading = index ? dateHeading(items[index - 1]!.startedAt) : null;
            return (
              <Fragment key={item.id}>
                {heading !== previousHeading && (
                  <h3 className="py-2 text-xs font-medium text-muted-foreground">{heading}</h3>
                )}
                <RecordingRow
                  name={item.name}
                  meta={`${item.actionCount} 步 · ${new Date(item.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  skillState={skillStates[item.id]}
                  gapCount={item.gapCount}
                  onOpen={() => open(item.id)}
                />
                {index < items.length - 1 && <Separator className="my-2" />}
              </Fragment>
            );
          })}
        </div>
      )}
      {!loading && !error && !items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{query ? '未找到匹配的录制' : '暂无录制记录'}</EmptyTitle>
          </EmptyHeader>
          {query && (
            <EmptyContent>
              <Button onClick={() => search('')}>清空搜索</Button>
            </EmptyContent>
          )}
        </Empty>
      )}
    </PopupPage>
  );
}

/**
 * Groups by local calendar dates without treating a daylight-saving day as a fixed twenty-four hours.
 */
function dateHeading(at: number): string {
  const date = new Date(at).toLocaleDateString();
  const today = new Date();
  if (date === today.toLocaleDateString()) {
    return `今天 · ${date}`;
  }
  today.setDate(today.getDate() - 1);
  if (date === today.toLocaleDateString()) {
    return `昨天 · ${date}`;
  }
  return date;
}
