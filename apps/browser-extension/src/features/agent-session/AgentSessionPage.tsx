/**
 * @author Codex
 * @description Displays one selected agent conversation while Worker retains execution authority and window-panel owns history.
 */
import { useEffect, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { Field, FieldLabel, FieldDescription } from '@octopus/ui/components/field';
import { browser } from 'wxt/browser';
import { SquareIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Badge } from '@octopus/ui/components/badge';
import { Alert } from '@octopus/custom-ui/components/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@octopus/ui/components/dialog';
import { PopupPage } from '../../components/PopupPage';
import { NavigationBar } from '../../components/NavigationBar';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import { skillError, type SkillCommand } from '../../lib/builtin-agent/skill-messages';
import type { RecordingSkillBinding } from '../../lib/builtin-agent/skill-session-repository';
import { skillDeletionBlock, type SkillSession } from '../../lib/builtin-agent/skill-session';
import type { SkillAnswer } from '../../lib/builtin-agent/skill-question';
import { modelSettingsRequest } from '../../lib/model-settings/model-settings-client';
import type { ModelSettings } from '../../lib/model-settings/model-settings-messages';
import { AgentConversation } from './AgentConversation';
import { skillModelLimit, skillBudgetMaximum } from '../../lib/builtin-agent/skill-budget';
import { sessionStatus } from './session-status';

/**
 * Starts only the requested task, reopens its exact history, and never turns settings tests into organization requests.
 */
export function AgentSessionPage({
  recordingId,
  mode,
  sessionId,
  autoStart = true,
  backLabel = '返回录制',
  back,
  openSettings,
}: {
  recordingId: string;
  mode: 'organize' | 'replay';
  sessionId?: string;
  autoStart?: boolean;
  backLabel?: string;
  back: () => void;
  openSettings: () => void;
}) {
  const FailureIcon = sessionStatus.failed.icon;
  const [session, setSession] = useState<SkillSession>();
  const [selectedId, setSelectedId] = useState<string | undefined>(sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState<ModelSettings>();
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState<SkillSession>();
  const [deleteError, setDeleteError] = useState('');
  const [extendBudget, setExtendBudget] = useState(false);
  const [cachedCopy, setCachedCopy] = useState<{ skillId: string; contentHash: string; cachedAt: number }>();
  const approvedSettings = useRef<ModelSettings | undefined>(undefined);
  const working = useRef(false);
  const started = useRef(false);
  const alive = useRef(true);
  const deletionForm = useForm({ defaultValues: { deleteSkill: false } });

  /**
   * Runs one explicit action and keeps the returned task identity instead of following a global latest task.
   */
  async function perform(command: SkillCommand): Promise<SkillSession> {
    if (working.current) {
      throw new Error('SKILL_BUSY');
    }
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await skillRequest<SkillSession>(command);
      if (alive.current) {
        setSession(value);
        setSelectedId(value.id);
      }
      return value;
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  }

  /**
   * Obtains endpoint-specific sending approval only when Worker requires it; no probe request is made.
   */
  async function start(approved?: ModelSettings, browserCopy?: { skillId: string; contentHash: string }) {
    const targetMode = session?.mode ?? mode;
    if (!targetMode) {
      return;
    }
    if (approved) {
      approvedSettings.current = approved;
      setConsent(undefined);
    }
    setCachedCopy(undefined);
    try {
      await perform({
        type: 'skill.start',
        recordingId,
        mode: targetMode,
        browserCopy,
        consent: approved ? { baseUrl: approved.baseUrl, model: approved.model } : undefined,
      });
      if (alive.current) {
        setConsent(undefined);
      }
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : 'SKILL_STORAGE';
      if (!alive.current) {
        return;
      }
      if (code === 'SKILL_CACHED_COPY_CONFIRMATION_REQUIRED') {
        try {
          const state = await skillRequest<{ binding?: RecordingSkillBinding }>({
            type: 'skill.state',
            recordingId,
          });
          if (!state.binding?.cache) {
            throw new Error('SKILL_NO_BROWSER_COPY', { cause: failure });
          }
          if (alive.current) {
            setCachedCopy({
              skillId: state.binding.skillId,
              contentHash: state.binding.cache.contentHash,
              cachedAt: state.binding.cache.cachedAt,
            });
            setError('');
          }
        } catch (failure) {
          if (alive.current) {
            setError(skillError(failure instanceof Error ? failure.message : ''));
          }
        }
        return;
      }
      if (code === 'SKILL_SETTINGS_REQUIRED') {
        openSettings();
      } else if (code === 'SKILL_CONSENT_REQUIRED') {
        const settings = await modelSettingsRequest<ModelSettings | null>(
          { type: 'settings-read' },
          new AbortController().signal
        );
        if (alive.current && settings) {
          setConsent(settings);
        }
      }
      setError(skillError(code));
    }
  }
  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      if (!sessionId && autoStart) {
        void start();
      }
    }
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let revision = 0;
    /**
     * Reads only the selected task or recording-scoped history after an authority publication.
     */
    const refresh = async () => {
      const attempt = ++revision;
      try {
        if (selectedId) {
          const value = await skillRequest<SkillSession>({ type: 'skill.get', id: selectedId });
          if (active && attempt === revision) {
            setSession(value);
          }
        }
      } catch (failure) {
        if (active && failure instanceof Error && failure.message === 'SKILL_MISSING') {
          back();
          return;
        }
        if (active) {
          setError(skillError(failure instanceof Error ? failure.message : ''));
        }
      }
    };
    /**
     * Storage contains only a refresh marker, never a second mutable conversation.
     */
    const changed = (changes: Record<string, unknown>) => {
      if (changes.skillRevision) {
        void refresh();
      }
    };
    browser.storage.onChanged.addListener(changed);
    void refresh();
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, [selectedId, recordingId]);

  /**
   * Submits the current question's original call identity and expected durable revision.
   */
  async function answer(submissionId: string, value: SkillAnswer): Promise<void> {
    if (!session?.pendingQuestion) {
      throw new Error('SKILL_QUESTION_STALE');
    }
    await perform({
      type: 'skill.answer',
      id: session.id,
      epoch: session.epoch,
      revision: session.revision,
      submissionId,
      toolCallId: session.pendingQuestion.toolCallId,
      answer: value,
    });
  }
  /**
   * Exposes a domain error at the current page without moving the user to settings for unrelated failures.
   */
  function action(command: SkillCommand) {
    void perform(command).catch((failure) =>
      setError(skillError(failure instanceof Error ? failure.message : ''))
    );
  }

  /**
   * Confirms the captured revision; a changed task cannot be deleted by a stale dialog.
   */
  async function removeSession() {
    if (!deleting || working.current) {
      return;
    }
    working.current = true;
    setBusy(true);
    setDeleteError('');
    try {
      await skillRequest({
        type: 'skill.delete',
        id: deleting.id,
        epoch: deleting.epoch,
        revision: deleting.revision,
        deleteSkill:
          deleting.mode === 'organize' &&
          Boolean(deleting.operationId) &&
          deletionForm.state.values.deleteSkill,
      });
      if (alive.current) {
        setDeleting(undefined);
        back();
      }
    } catch (failure) {
      if (alive.current) {
        setDeleteError(skillError(failure instanceof Error ? failure.message : 'SKILL_STORAGE'));
      }
    } finally {
      working.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  }

  const preparationLabel = busy ? '正在准备任务…' : '任务尚未开始。';
  let footer = (
    <Button variant="outline" onClick={back}>
      {backLabel}
    </Button>
  );
  if (session) {
    if (session.status === 'failed' && session.error === 'SKILL_NO_TOOL') {
      footer = (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {session.mode === 'replay'
              ? '保留已执行操作，先观察当前页面，再补充提问或结束结果。'
              : '保留现有整理记录，补充工具调用后继续。'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={back}>
              {backLabel}
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => action({ type: 'skill.continue', id: session.id, epoch: session.epoch })}
            >
              {session.mode === 'replay' ? '核对并继续' : '继续整理'}
            </Button>
          </div>
        </div>
      );
    } else if (
      session.status === 'failed' &&
      ['SKILL_MODEL_BUDGET', 'SKILL_TOOL_BUDGET'].includes(session.error ?? '')
    ) {
      footer = (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            已使用 {session.modelCalls}/{skillModelLimit(session)} 轮
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" variant="outline" onClick={openSettings}>
              执行限制设置
            </Button>
            <Button
              className="flex-1"
              disabled={busy || skillModelLimit(session) >= skillBudgetMaximum}
              onClick={() => setExtendBudget(true)}
            >
              追加轮数并继续
            </Button>
          </div>
        </div>
      );
    } else if (session.status === 'waiting_user') {
      footer = (
        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" disabled={busy} onClick={back}>
            稍后处理
          </Button>
          <Button className="flex-1" type="submit" form="skill-answer-form" disabled={busy}>
            确认并继续
          </Button>
        </div>
      );
    } else if (session.status === 'running') {
      footer = (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => action({ type: 'skill.cancel', id: session.id, epoch: session.epoch })}
        >
          停止任务
        </Button>
      );
    } else if (session.status === 'saving' || (session.status === 'outcome_unknown' && session.candidate)) {
      footer = (
        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={back}>
            {backLabel}
          </Button>
          <Button
            className="flex-1"
            disabled={busy || (!session.error && session.status === 'saving')}
            onClick={() => action({ type: 'skill.retry-save', id: session.id, epoch: session.epoch })}
          >
            {session.error || session.status === 'outcome_unknown' ? '重试保存' : '正在保存…'}
          </Button>
        </div>
      );
    } else if (session.status === 'outcome_unknown') {
      footer = (
        <Button variant="outline" disabled={busy} onClick={() => setResolving(true)}>
          核实并结束任务
        </Button>
      );
    } else if (session.status === 'interrupted') {
      footer = (
        <Button
          disabled={busy}
          onClick={() => action({ type: 'skill.continue', id: session.id, epoch: session.epoch })}
        >
          继续
        </Button>
      );
    } else if (session.mode === 'organize' && ['failed', 'cancelled', 'completed'].includes(session.status)) {
      footer = (
        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={back}>
            {backLabel}
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => void start()}>
            {session.status === 'completed' ? '重新整理' : '重试整理'}
          </Button>
        </div>
      );
    }
  }
  return (
    <>
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDeleting(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这次{deleting?.mode === 'replay' ? '重放' : '整理'}会话？</DialogTitle>
            <DialogDescription>
              会话记录和问答内容将被永久删除，录制保留。默认保留已生成的技能。
            </DialogDescription>
          </DialogHeader>
          {deleting?.mode === 'organize' && deleting.operationId && (
            <deletionForm.Field name="deleteSkill">
              {(field) => (
                <Field data-disabled={busy}>
                  <FieldLabel>
                    <Checkbox
                      checked={field.state.value}
                      disabled={busy}
                      onCheckedChange={(checked) => field.handleChange(checked === true)}
                      onBlur={field.handleBlur}
                    />
                    同时删除本次生成的技能
                  </FieldLabel>
                  <FieldDescription>
                    删除浏览器技能副本及已保存的本地技能文件（含手工修改）。本地删除需要连接
                    Executor；不会删除其他整理会话生成的技能。
                  </FieldDescription>
                </Field>
              )}
            </deletionForm.Field>
          )}
          {deleteError && <Alert variant="danger" description={deleteError} />}
          <DialogFooter className="flex-row justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void removeSession()}>
              {busy ? '正在删除…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {session && (
        <PopupPage
          scrollLabel="智能体会话"
          header={
            <NavigationBar
              title={session.mode === 'organize' ? '整理技能' : '运行技能'}
              onBack={back}
              trailing={
                <>
                  <Badge variant={sessionStatus[session.status].variant}>
                    {session.status === 'failed' && <FailureIcon aria-hidden="true" />}
                    {session.mode === 'replay' && session.status === 'completed'
                      ? '已结束'
                      : sessionStatus[session.status].label}
                  </Badge>
                  <Button
                    variant="destructive"
                    size="icon-sm"
                    title={skillDeletionBlock(session) ?? '删除会话'}
                    aria-label="删除会话"
                    disabled={busy || Boolean(skillDeletionBlock(session))}
                    onClick={() => {
                      setDeleteError('');
                      setDeleting(session);
                      deletionForm.reset();
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                  {session.status === 'waiting_user' && (
                    <Button
                      variant="destructive"
                      size="icon-xs"
                      className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
                      title="停止任务"
                      aria-label="停止任务"
                      disabled={busy}
                      onClick={() => action({ type: 'skill.cancel', id: session.id, epoch: session.epoch })}
                    >
                      <SquareIcon fill="currentColor" strokeWidth={0} />
                    </Button>
                  )}
                </>
              }
            />
          }
          footer={
            <>
              {error && <Alert variant="danger" description={error} />}
              {footer}
            </>
          }
          scrollViewport={<AgentConversation session={session} busy={busy} answer={answer} />}
        >
          {null}
        </PopupPage>
      )}
      {!session && (
        <PopupPage
          scrollLabel="准备任务"
          header={<NavigationBar title={mode === 'organize' ? '整理技能' : '运行技能'} onBack={back} />}
          footer={
            <Button
              disabled={busy}
              onClick={() => {
                if (sessionId) {
                  action({ type: 'skill.get', id: sessionId });
                } else {
                  void start();
                }
              }}
            >
              {sessionId ? '重新加载' : '继续'}
            </Button>
          }
        >
          {error ? (
            <Alert variant="danger" description={error} />
          ) : (
            <p className="text-sm text-muted-foreground">{sessionId ? '正在读取会话…' : preparationLabel}</p>
          )}
        </PopupPage>
      )}
      <Dialog
        open={Boolean(consent)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConsent(undefined);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>允许发送本次任务信息？</DialogTitle>
            <DialogDescription>
              {mode === 'replay'
                ? '将技能、本次输入及必要页面内容发送至当前模型，用于运行技能。'
                : '将脱敏录制和本次回答发送至当前模型，用于整理技能。'}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-xs">{consent?.baseUrl}</p>
          <p className="text-sm">模型：{consent?.model}</p>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConsent(undefined)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void start(consent)}>
              允许并继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cachedCopy)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setCachedCopy(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>使用浏览器副本重放？</DialogTitle>
            <DialogDescription>
              当前无法读取本地技能文件。浏览器副本可能不包含后续手工修改；确认后仅使用该副本执行本次任务。
            </DialogDescription>
          </DialogHeader>
          {cachedCopy && (
            <p className="text-sm">副本时间：{new Date(cachedCopy.cachedAt).toLocaleString()}</p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCachedCopy(undefined)}>
              取消
            </Button>
            <Button
              disabled={busy || !cachedCopy}
              onClick={() => void start(approvedSettings.current, cachedCopy)}
            >
              使用副本继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={extendBudget} onOpenChange={setExtendBudget}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>追加模型调用轮数？</DialogTitle>
            <DialogDescription>
              继续当前会话，不重新执行已完成操作。重放会重新观察页面；追加调用可能产生费用。
            </DialogDescription>
          </DialogHeader>
          {session && (
            <p className="text-sm">
              已使用 {session.modelCalls}/{skillModelLimit(session)} 轮，本次追加{' '}
              {Math.min(20, skillBudgetMaximum - skillModelLimit(session))} 轮。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendBudget(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !session || skillModelLimit(session) >= skillBudgetMaximum}
              onClick={() => {
                if (!session) {
                  return;
                }
                setExtendBudget(false);
                action({
                  type: 'skill.extend-budget',
                  id: session.id,
                  epoch: session.epoch,
                  revision: session.revision,
                  additional: Math.min(20, skillBudgetMaximum - skillModelLimit(session)),
                });
              }}
            >
              确认追加并继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resolving} onOpenChange={setResolving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认已核实网页结果？</DialogTitle>
            <DialogDescription>
              结束任务不会撤销已发出的操作。请先在网页核实结果；确认后只结束本次任务，不会重试原操作。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (session) {
                  action({
                    type: 'skill.resolve-unknown',
                    id: session.id,
                    epoch: session.epoch,
                    confirmed: true,
                  });
                }
                setResolving(false);
              }}
            >
              已核实并结束
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
