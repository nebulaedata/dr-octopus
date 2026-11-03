/**
 * @author Codex
 * @description Composes recording scope, active controls and saved records from authoritative popup state.
 */
import { Fragment, useState } from 'react';
import { Separator } from '@octopus/ui/components/separator';
import {
  MousePointerClickIcon,
  FileTextIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@octopus/ui/components/card';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { RecordingRow } from './RecordingRow';
import type { RecordingSkillState } from '../../lib/builtin-agent/skill-messages';
import {
  recordingDuration,
  type RecordingRequest,
  type RecordingView,
} from '../../lib/recording/recording-contract';

/**
 * Keeps transient form choices local while all actual recording controls go through the worker.
 */
export function RecordingPanel({
  view,
  busy,
  now,
  command,
  open,
  showAll,
  skillStates,
}: {
  view: RecordingView;
  busy: boolean;
  now: number;
  command: (request: RecordingRequest) => void;
  open: (id: string) => void;
  showAll: () => void;
  skillStates: Record<string, RecordingSkillState>;
}) {
  const [related, setRelated] = useState(false);
  const [adding, setAdding] = useState(false);
  const session = view.active;
  const current = view.current;
  const included = session?.pages.some((page) => page.included && page.tabId === current?.tabId);
  const records = view.recent;
  return (
    <div className="flex flex-col gap-4">
      {session ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex justify-between">
              <span>{session.status === 'recording' ? '录制中' : '已暂停'}</span>
              <span className="tabular-nums">{recordingDuration(session, now)}</span>
            </CardTitle>
            <CardDescription>
              {session.actionCount} 步 · {session.pages.filter((page) => page.included).length} 个参与页面
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">录制范围</h3>
            {session.pages
              .filter((page) => page.included)
              .map((page) => (
                <div key={page.tabRef} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{page.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{page.origin}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      command({ type: 'recorder.remove', sessionId: session.id, tabId: page.tabId })
                    }
                  >
                    移出
                  </Button>
                </div>
              ))}
            {current && !included && (
              <Alert
                variant="info"
                showIcon
                description={<>当前页面未加入：{current.origin}</>}
                details={adding ? '允许录制此站点并加入当前页面？' : null}
                action={
                  adding ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setAdding(false);
                          command({ type: 'recorder.include', sessionId: session.id, tabId: current.tabId });
                        }}
                      >
                        确认加入
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setAdding(true)}>
                      加入当前页面
                    </Button>
                  )
                }
              />
            )}
            {session.gaps.length > 0 && (
              <p className="text-pretty text-xs text-muted-foreground">
                存在未记录范围或未确认操作，保存后可查看详情。
              </p>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy || session.status === 'stopping'}
              onClick={() =>
                command({
                  type: 'recorder.control',
                  sessionId: session.id,
                  action: session.status === 'recording' ? 'pause' : 'resume',
                })
              }
            >
              {session.status === 'recording' ? (
                <PauseIcon data-icon="inline-start" />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              {session.status === 'recording' ? '暂停录制' : '继续录制'}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => command({ type: 'recorder.control', sessionId: session.id, action: 'stop' })}
            >
              <SquareIcon data-icon="inline-start" />
              停止保存
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>新建录制</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <FileTextIcon className="size-5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm">{current?.title ?? '请切换到普通网页'}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {current?.origin ?? '受限页面无法录制'}
                </span>
              </div>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id="include-related"
                checked={related}
                onCheckedChange={(checked) => setRelated(checked === true)}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="include-related">同时录制从当前页面打开的新标签页</FieldLabel>
              </div>
            </Field>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2">
            <Button
              disabled={busy || !current}
              onClick={() => {
                if (current) {
                  command({ type: 'recorder.start', tabId: current.tabId, includeRelated: related });
                }
              }}
            >
              <MousePointerClickIcon data-icon="inline-start" />
              开始录制
            </Button>
          </CardFooter>
        </Card>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">最近录制</h2>
        <Button variant="ghost" size="sm" onClick={showAll}>
          查看全部
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
      <div className="flex flex-col gap-0 rounded-xl border px-3 py-2">
        {records.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 && <Separator className="my-2" />}
            <RecordingRow
              name={item.name}
              meta={`${item.actionCount} 步 · ${new Date(item.startedAt).toLocaleDateString()}`}
              skillState={skillStates[item.id]}
              gapCount={item.gapCount}
              onOpen={() => open(item.id)}
            />
          </Fragment>
        ))}
        {!records.length && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>暂无录制记录</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}
