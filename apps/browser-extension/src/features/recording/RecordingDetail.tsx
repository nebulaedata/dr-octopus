/**
 * @author Codex
 * @description Presents recorded evidence with explicit Skill organization viewing, file and replay actions.
 */
import { useEffect, useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { browser } from 'wxt/browser';
import { Trash2Icon, FileTextIcon, PlayIcon, SparklesIcon } from 'lucide-react';
import { Separator } from '@octopus/ui/components/separator';
import { Button } from '@octopus/ui/components/button';
import { Input } from '@octopus/ui/components/input';
import { Field, FieldLabel } from '@octopus/ui/components/field';
import { Alert } from '@octopus/custom-ui/components/alert';
import { PopupPage } from '../../components/PopupPage';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@octopus/ui/components/empty';
import { NavigationBar } from '../../components/NavigationBar';
import { SkillFiles } from '../skill-library/SkillFiles';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import { skillError } from '../../lib/builtin-agent/skill-messages';
import type { SkillSession } from '../../lib/builtin-agent/skill-session';
import type { RecordingSkillBinding } from '../../lib/builtin-agent/skill-session-repository';
import {
  recordingDuration,
  type RecordedEvent,
  type RecordingSession,
} from '../../lib/recording/recording-contract';

/**
 * Keeps record deletion independent from generated files and never starts a duplicate task from an active session.
 */
export function RecordingDetail({
  session,
  events,
  busy,
  back,
  more,
  rename,
  remove,
  openSkill,
}: {
  session: RecordingSession;
  events: RecordedEvent[];
  busy: boolean;
  back: () => void;
  more: () => void;
  rename: (name: string) => void;
  remove: () => void;
  openSkill?: (mode: 'organize' | 'replay', recordingId: string, sessionId?: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [state, setState] = useState<{
    sessions: SkillSession[];
    binding?: RecordingSkillBinding;
    fileConnected?: boolean;
  }>();
  const [error, setError] = useState('');
  const form = useForm({
    defaultValues: { name: session.name },
    onSubmit: ({ value }) => rename(value.name.trim()),
  });
  const name = useStore(form.store, (value) => value.values.name);
  useEffect(() => {
    let alive = true;
    let revision = 0;
    /** Reads the current record's binding without treating a storage event as state authority. */
    const refresh = async () => {
      const attempt = ++revision;
      try {
        const value = await skillRequest<{
          sessions: SkillSession[];
          binding?: RecordingSkillBinding;
          fileConnected?: boolean;
        }>({
          type: 'skill.state',
          recordingId: session.id,
        });
        if (alive && revision === attempt) {
          setState(value);
        }
      } catch (failure) {
        if (alive && revision === attempt) {
          setError(skillError(failure instanceof Error ? failure.message : ''));
        }
      }
    };
    /** Refreshes only after Skill authority publishes a change. */
    const changed = (changes: Record<string, unknown>) => {
      if (changes.skillRevision || changes.bridgeStatus) {
        void refresh();
      }
    };
    browser.storage.onChanged.addListener(changed);
    void refresh();
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, [session.id]);
  const active = state?.sessions.find(
    (item) => item.mode === 'organize' && ['running', 'waiting_user', 'saving'].includes(item.status)
  );
  const organization = state?.sessions
    .filter((item) => item.mode === 'organize')
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0];
  const replay = state?.sessions.find(
    (item) =>
      item.mode === 'replay' && ['running', 'waiting_user', 'saving', 'outcome_unknown'].includes(item.status)
  );
  let label = '开始整理';
  let OrganizationIcon = SparklesIcon;
  if (organization) {
    label = '查看整理';
    OrganizationIcon = FileTextIcon;
  }
  let sessionStatus = '尚未整理';
  if (state?.binding) {
    sessionStatus = state.binding.storage === 'executor' ? '已关联本地目录' : '已保存到浏览器';
  } else if (active) {
    sessionStatus = '正在整理';
  }
  return (
    <PopupPage
      scrollLabel="录制详情内容"
      header={
        <NavigationBar
          title="录制详情"
          onBack={back}
          backLabel="返回录制记录"
          trailing={
            <>
              <Button
                variant="destructive"
                size="icon"
                title="删除录制"
                aria-label="删除录制"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
              </Button>
            </>
          }
        />
      }
      footer={
        <>
          {confirmDelete && (
            <Alert
              variant="danger"
              showIcon
              title="删除这份录制？"
              description="删除后无法恢复。"
              action={
                <>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
                    取消
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={remove}>
                    确认删除
                  </Button>
                </>
              }
            />
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={state?.binding ? 'outline' : 'default'}
              disabled={busy || confirmDelete || !state || !session.count}
              onClick={() => openSkill?.('organize', session.id, organization?.id)}
            >
              <OrganizationIcon data-icon="inline-start" />
              {label}
            </Button>
            <Button
              className="flex-1"
              disabled={busy || confirmDelete || !state?.binding}
              title={replay ? '已有重放会话，点击查看，不会新建任务。' : '新建重放会话'}
              onClick={() => openSkill?.('replay', session.id, replay?.id)}
            >
              <PlayIcon data-icon="inline-start" />
              {replay ? '查看重放' : '重放'}
            </Button>
          </div>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Field>
          <FieldLabel htmlFor="recording-name">名称</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="recording-name"
              value={name}
              maxLength={80}
              onBlur={() => form.setFieldMeta('name', (previous) => ({ ...previous, isTouched: true }))}
              onChange={(event) => form.setFieldValue('name', event.target.value)}
            />
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === session.name}>
              保存
            </Button>
          </div>
        </Field>
      </form>
      <p className="text-xs tabular-nums text-muted-foreground">
        {new Date(session.startedAt).toLocaleString()} · {recordingDuration(session)} · {session.pages.length}{' '}
        个页面
      </p>
      <SkillFiles
        key={state?.binding?.skillId ?? session.id}
        binding={state?.binding}
        recordingId={session.id}
        connected={state?.fileConnected === true}
        status={sessionStatus}
      />
      {error && <Alert variant="danger" description={error} />}
      {session.gaps.length > 0 && (
        <Alert
          variant="warning"
          showIcon
          title="部分操作可能未记录"
          description={
            <ul className="flex w-full flex-col gap-0">
              {session.gaps.map((gap) => (
                <li key={gap} className="break-all text-wrap!">
                  {gap}
                </li>
              ))}
            </ul>
          }
        />
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">操作步骤</h2>
        <span className="text-xs text-muted-foreground">{session.actionCount} 步</span>
      </div>
      {events.length > 0 && (
        <ol className="flex flex-col gap-0 rounded-xl border px-3 py-2">
          {events.map((event, index) => (
            <li key={event.id}>
              {index > 0 && <Separator className="my-2" />}
              <div className="flex gap-2 py-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {event.causationId ? '关联' : event.seq}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="break-words text-sm">{actionLabel(event)}</span>
                  <span className="text-xs text-muted-foreground">
                    {session.pages.find((page) => page.tabRef === event.tabRef)?.title ?? '参与页面'}
                  </span>
                  {event.redacted && <span className="text-xs text-muted-foreground">已隐藏输入值</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {events.length < session.count && (
        <Button variant="outline" disabled={busy} onClick={more}>
          加载更多步骤
        </Button>
      )}
      {!events.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>暂无已保存的操作</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </PopupPage>
  );
}

/**
 * Turns a recorded semantic target into a readable action without exposing protocol action codes.
 */
function actionLabel(event: RecordedEvent): string {
  if (event.action === 'input' && !event.label.startsWith('填写')) {
    return `填写${event.label}`;
  }
  if (event.action === 'click' && !event.label.startsWith('点击')) {
    return `点击${event.label}`;
  }
  if (event.action === 'select' && !event.label.startsWith('选择')) {
    return `选择${event.label}`;
  }
  return event.label;
}
