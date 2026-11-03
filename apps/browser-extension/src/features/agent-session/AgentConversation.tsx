/**
 * @author Codex
 * @description Projects persisted SDK messages and tool outcomes as an anchored, bounded agent timeline.
 */
import type { ReactNode } from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { ScrollArea, ScrollBar } from '@octopus/ui/components/scroll-area';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@octopus/ui/components/message-scroller';
import { Message, MessageContent, MessageAvatar } from '@octopus/ui/components/message';
import { Avatar, AvatarFallback } from '@octopus/ui/components/avatar';
import { UserRoundIcon, BotIcon, WrenchIcon, ArrowDownIcon, ChevronRightIcon } from 'lucide-react';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Marker, MarkerContent } from '@octopus/ui/components/marker';
import { Card, CardContent } from '@octopus/ui/components/card';
import { Box } from '../../components/Box';
import type { SkillSession } from '../../lib/builtin-agent/skill-session';
import type { SkillAnswer } from '../../lib/builtin-agent/skill-question';
import { skillError } from '../../lib/builtin-agent/skill-messages';
import { pageAccessMessage } from '../../page-access';
import { skillToolDiagnostic } from '../../lib/builtin-agent/skill-tool-diagnostic';
import { CopySessionDiagnostic } from './CopySessionDiagnostic';
import { AgentQuestionForm } from './AgentQuestionForm';

const labels: Record<string, string> = {
  read_recording: '读取录制',
  read_skill: '读取技能',
  apply_choice: '应用录制选择',
  validate_skill: '校验技能',
  submit_skill: '保存技能',
  ask_user_question: '询问用户',
  browser_tabs: '查看标签页',
  browser_snapshot: '观察页面',
  browser_read_snapshot: '读取页面',
  browser_click: '点击控件',
  browser_fill: '填写内容',
  browser_select: '选择选项',
  browser_scroll: '滚动页面',
  browser_navigate: '页面导航',
  browser_open_tab: '打开标签页',
  browser_close_tab: '关闭标签页',
  finish_run: '执行结果',
};

/**
 * Animates only current execution copy, with readable static text for reduced-motion users.
 */
function ExecutionMarker({ children }: { children: ReactNode }) {
  return (
    <Marker render={<span />} className="leading-5" data-slot="skill-execution-marker">
      <MarkerContent className="motion-safe:shimmer">{children}</MarkerContent>
    </Marker>
  );
}

/**
 * Keeps disclosure controls keyboard-native with a consistent icon and first-line alignment.
 */
function ToolDetails({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="group/tool-details min-w-0">
      <summary className="flex min-h-5 cursor-pointer list-none items-start gap-1 rounded-sm text-sm leading-5 font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open/tool-details:rotate-90"
        />
        <span className="min-w-0 break-words">{label}</span>
      </summary>
      <div className="mt-2 min-w-0">{children}</div>
    </details>
  );
}

/**
 * Explains implicit scope for tools with no input parameters.
 */
const emptyToolDescriptions: Record<string, string | undefined> = {
  read_skill: '读取当前会话绑定的技能，无需额外参数。',
  browser_tabs: '列出本次任务允许访问的标签页，无需额外参数。',
};

/**
 * Keeps expanded payloads bounded within their card; short descriptions remain content-sized.
 */
function JsonContent({ value, emptyDescription }: { value: unknown; emptyDescription?: string }) {
  const empty =
    emptyDescription &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;
  if (empty) {
    return (
      <Card size="sm">
        <CardContent>
          <p className="text-sm text-muted-foreground">{emptyDescription}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card size="sm" className="py-0">
      <ScrollArea
        data-slot="tool-payload-scroll"
        role="region"
        aria-label="工具详情"
        className="min-w-0 rounded-[inherit] [&_[data-slot=scroll-area-viewport]]:max-h-[min(20rem,40dvh)] [&_[data-slot=scroll-area-viewport]]:focus-visible:ring-inset"
      >
        <CardContent className="py-3 pr-5">
          <pre className="whitespace-pre-wrap break-all text-xs leading-relaxed text-muted-foreground">
            {JSON.stringify(value, null, 2)}
          </pre>
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

/**
 * Keeps corrected question errors inspectable while projecting stable ledger diagnostics instead of SDK error text.
 */
function ToolFailure({
  session,
  code,
  part,
  messageIndex,
  partIndex,
}: {
  session: SkillSession;
  code: string;
  part: { toolCallId: string; toolName: string };
  messageIndex: number;
  partIndex: number;
}) {
  const diagnostic = skillToolDiagnostic(session, part.toolCallId, part.toolName, code, messageIndex);
  let description = skillError(diagnostic.code);
  if (diagnostic.access) {
    description = pageAccessMessage(diagnostic.access);
  }
  if (diagnostic.recovered) {
    description = '此次提问的参数错误已纠正，原错误保留供排查。';
  }
  const alert = (
    <Alert
      variant={diagnostic.recovered ? 'info' : 'danger'}
      description={description}
      action={
        <CopySessionDiagnostic
          session={session}
          code={diagnostic.code}
          source="tool"
          toolCallId={part.toolCallId}
          toolName={part.toolName}
          messageIndex={messageIndex}
          partIndex={partIndex}
        />
      }
      details={
        <ToolDetails label="查看详情">
          <p className="break-all text-xs">{diagnostic.code}</p>
          {diagnostic.issues.length > 0 && <JsonContent value={diagnostic.issues} />}
        </ToolDetails>
      }
    />
  );
  return diagnostic.recovered ? (
    <ToolDetails label={`${labels[part.toolName] ?? part.toolName} · 参数已纠正`}>{alert}</ToolDetails>
  ) : (
    alert
  );
}

/**
 * Chooses the transcript role icon without interpreting model content as UI instructions.
 */
function messageAvatar(role: string) {
  if (role === 'user') {
    return <UserRoundIcon className="size-3" />;
  }
  if (role === 'tool') {
    return <WrenchIcon className="size-3" />;
  }
  return <BotIcon className="size-3" />;
}

/**
 * Connects adjacent transcript nodes while keeping their icon aligned with the first content line.
 */
function TimelineEntry({
  id,
  role,
  last,
  anchor = false,
  children,
}: {
  id: string;
  role: string;
  last: boolean;
  anchor?: boolean;
  children: ReactNode;
}) {
  return (
    <MessageScrollerItem
      messageId={id}
      scrollAnchor={anchor}
      data-last={last}
      data-slot="skill-timeline-entry"
      className="relative before:absolute before:inset-y-0 before:left-6.5 before:w-px before:bg-border first:before:top-5.5 data-[last=true]:before:bottom-auto data-[last=true]:before:h-5.5 first:data-[last=true]:before:hidden"
    >
      <Box className="py-3">
        <Message>
          <MessageAvatar className="relative min-w-5 self-start">
            <Avatar className="size-5">
              <AvatarFallback>{messageAvatar(role)}</AvatarFallback>
            </Avatar>
          </MessageAvatar>
          <MessageContent>{children}</MessageContent>
        </Message>
      </Box>
    </MessageScrollerItem>
  );
}

/**
 * Displays actual conversation parts; user answers stay tool results and cannot become arbitrary new chat messages.
 */
export function AgentConversation({
  session,
  busy,
  answer,
}: {
  session: SkillSession;
  busy: boolean;
  answer: (submissionId: string, value: SkillAnswer) => Promise<void>;
}) {
  const pending = session.pendingQuestion;
  const executing = (session.status === 'running' || session.status === 'saving') && !session.error;
  const latest = session.messages.at(-1);
  const activeCall =
    executing && latest?.role === 'assistant' && Array.isArray(latest.content)
      ? latest.content.findLast(
          (part) =>
            part.type === 'tool-call' &&
            ['pending', 'dispatched'].includes(session.ledger?.[part.toolCallId]?.state ?? '')
        )
      : undefined;
  const progress = executing && !activeCall && session.status === 'running';
  return (
    <MessageScrollerProvider autoScroll>
      <ScrollAreaPrimitive.Root
        render={<MessageScroller />}
        className="min-h-0 flex-1"
        data-slot="scroll-area"
      >
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          render={
            <MessageScrollerViewport
              className="scrollbar-gutter-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="智能体会话"
            />
          }
        >
          <MessageScrollerContent className="gap-0">
            {session.skillSource?.storage === 'cached' && (
              <MessageScrollerItem messageId="copy-source">
                <Box>
                  <Alert
                    variant="info"
                    description={
                      '本次使用浏览器副本（' +
                      new Date(session.skillSource.cachedAt).toLocaleString() +
                      '），可能未包含本地文件的后续修改。'
                    }
                  />
                </Box>
              </MessageScrollerItem>
            )}

            {session.messages.map((message, index) => (
              <TimelineEntry
                key={index}
                id={session.id + '-' + index}
                role={message.role}
                last={
                  index === session.messages.length - 1 &&
                  !session.error &&
                  !session.result &&
                  !session.manualResolutionAt &&
                  !progress
                }
                anchor={
                  Array.isArray(message.content) &&
                  message.content.some(
                    (part) => part.type === 'tool-call' && part.toolCallId === pending?.toolCallId
                  )
                }
              >
                {typeof message.content === 'string' ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.content}</p>
                ) : (
                  message.content.map((part, partIndex) => {
                    if (part.type === 'text' || part.type === 'reasoning') {
                      return (
                        <p key={partIndex} className="whitespace-pre-wrap break-words text-sm leading-5">
                          {part.text}
                        </p>
                      );
                    }
                    if (part.type === 'tool-call') {
                      if (session.status === 'waiting_user' && part.toolCallId === pending?.toolCallId) {
                        return (
                          <AgentQuestionForm
                            key={part.toolCallId}
                            id="skill-answer-form"
                            question={pending.question}
                            submit={answer}
                            busy={busy}
                          />
                        );
                      }
                      const entry = session.ledger?.[part.toolCallId];
                      const waiting =
                        session.mode === 'replay' && activeCall === part && entry?.state === 'dispatched'
                          ? entry.waitProgress
                          : undefined;
                      let waitLabel = '';
                      if (waiting) {
                        waitLabel =
                          waiting.attempt === 1
                            ? `等待页面就绪… ${waiting.attempt}/${waiting.attempts}`
                            : `页面尚未就绪，重试中… ${waiting.attempt}/${waiting.attempts}`;
                      }
                      return (
                        <div key={partIndex}>
                          <ToolDetails
                            label={
                              activeCall === part && !waiting ? (
                                <ExecutionMarker>{labels[part.toolName] ?? part.toolName}</ExecutionMarker>
                              ) : (
                                (labels[part.toolName] ?? part.toolName)
                              )
                            }
                          >
                            <JsonContent
                              value={session.ledger?.[part.toolCallId]?.presentedQuestion ?? part.input}
                              emptyDescription={emptyToolDescriptions[part.toolName]}
                            />
                          </ToolDetails>
                          {waiting && (
                            <p
                              role="status"
                              aria-live="polite"
                              aria-atomic="true"
                              className="mt-2 text-sm leading-5 text-muted-foreground tabular-nums"
                              data-slot="page-wait-progress"
                            >
                              <ExecutionMarker>{waitLabel}</ExecutionMarker>
                            </p>
                          )}
                        </div>
                      );
                    }
                    if (part.type === 'tool-result') {
                      if (
                        part.output.type === 'json' &&
                        part.output.value &&
                        typeof part.output.value === 'object' &&
                        !Array.isArray(part.output.value)
                      ) {
                        const value = part.output.value;
                        if ('valid' in value && value.valid === false) {
                          return (
                            <Alert
                              key={partIndex}
                              variant="danger"
                              description="技能内容未通过校验。"
                              action={
                                <CopySessionDiagnostic
                                  session={session}
                                  code="SKILL_INVALID"
                                  source="validation"
                                  issues={'issues' in value ? value.issues : undefined}
                                  toolCallId={part.toolCallId}
                                  toolName={part.toolName}
                                  messageIndex={index}
                                  partIndex={partIndex}
                                />
                              }
                              details={
                                <ToolDetails label="查看校验详情">
                                  <JsonContent value={'issues' in value ? value.issues : []} />
                                </ToolDetails>
                              }
                            />
                          );
                        }
                        if ('error' in value && typeof value.error === 'string') {
                          return (
                            <ToolFailure
                              key={partIndex}
                              session={session}
                              code={value.error}
                              part={part}
                              messageIndex={index}
                              partIndex={partIndex}
                            />
                          );
                        }
                      }
                      if (part.output.type === 'error-text') {
                        return (
                          <ToolFailure
                            key={partIndex}
                            session={session}
                            code={part.output.value}
                            part={part}
                            messageIndex={index}
                            partIndex={partIndex}
                          />
                        );
                      }
                      return (
                        <ToolDetails
                          key={partIndex}
                          label={
                            part.toolName === 'ask_user_question'
                              ? '用户回答'
                              : (labels[part.toolName] ?? part.toolName) + ' · 已返回'
                          }
                        >
                          <JsonContent
                            value={part.output.type === 'json' ? part.output.value : part.output}
                          />
                        </ToolDetails>
                      );
                    }
                    return null;
                  })
                )}
              </TimelineEntry>
            ))}
            {progress && (
              <TimelineEntry id={session.id + '-progress'} role="assistant" last>
                <span role="status">
                  <ExecutionMarker>
                    {session.mode === 'replay' ? '正在规划下一步…' : '正在整理…'}
                  </ExecutionMarker>
                </span>
              </TimelineEntry>
            )}
            {session.error && (
              <TimelineEntry
                id="failure"
                role="assistant"
                last={!session.result && !session.manualResolutionAt}
              >
                <Alert
                  variant="danger"
                  description={skillError(session.error)}
                  action={<CopySessionDiagnostic session={session} code={session.error} source="session" />}
                  details={
                    <ToolDetails label="查看详情">
                      <p className="break-all text-xs">{session.error}</p>
                    </ToolDetails>
                  }
                />
              </TimelineEntry>
            )}
            {session.result && (
              <TimelineEntry id="result" role="assistant" last={!session.manualResolutionAt}>
                <p className="whitespace-pre-wrap text-sm">{session.result.summary}</p>
                {session.result.outcome === 'incomplete' && (
                  <p className="text-xs text-muted-foreground">任务未完成。</p>
                )}
              </TimelineEntry>
            )}
            {session.manualResolutionAt && (
              <TimelineEntry id="manual-resolution" role="assistant" last>
                <Alert variant="info" description="已按你的确认结束任务，未重试原操作。" />
              </TimelineEntry>
            )}
          </MessageScrollerContent>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
        <MessageScrollerButton aria-label="回到最新" title="回到最新">
          <ArrowDownIcon />
          <span className="sr-only">回到最新</span>
        </MessageScrollerButton>
      </ScrollAreaPrimitive.Root>
    </MessageScrollerProvider>
  );
}
