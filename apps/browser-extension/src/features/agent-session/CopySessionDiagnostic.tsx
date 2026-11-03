/**
 * @author Codex
 * @description Copies bounded, value-free error diagnostics tied to a specific persisted agent session and timeline entry.
 */
import { useEffect, useRef, useState } from 'react';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import type { SkillSession } from '../../lib/builtin-agent/skill-session';
import { skillError } from '../../lib/builtin-agent/skill-messages';
import { pageAccessMessage, pageAccessSchema } from '../../page-access';
import { safeToolIssues, skillToolDiagnostic } from '../../lib/builtin-agent/skill-tool-diagnostic';

/**
 * Exports identifiers and stable error metadata only, excluding messages, tool inputs, provider responses and credentials.
 */
export function CopySessionDiagnostic({
  session,
  code,
  source,
  toolCallId,
  toolName,
  messageIndex,
  partIndex,
  issues,
}: {
  session: SkillSession;
  code: string;
  source: 'session' | 'tool' | 'validation';
  toolCallId?: string;
  toolName?: string;
  messageIndex?: number;
  partIndex?: number;
  issues?: unknown;
}) {
  const toolDiagnostic =
    source === 'tool' && toolCallId && toolName
      ? skillToolDiagnostic(session, toolCallId, toolName, code, messageIndex ?? -1)
      : undefined;
  const candidate = toolDiagnostic?.code ?? code;
  const errorCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(candidate) ? candidate : 'UNCLASSIFIED_ERROR';
  const lastAccess = source === 'session' ? pageAccessSchema.safeParse(session.pageAccess) : undefined;
  const access = toolDiagnostic?.access ?? (lastAccess?.success ? lastAccess.data : undefined);
  let errorMessage = skillError(errorCode);
  if (toolDiagnostic?.access) {
    errorMessage = pageAccessMessage(toolDiagnostic.access);
  }
  if (source === 'validation') {
    errorMessage = '技能内容未通过校验。';
  }
  const validationIssues =
    issues !== undefined || toolDiagnostic?.issues.length
      ? safeToolIssues(issues ?? toolDiagnostic?.issues).map((issue, index) => ({ index, ...issue }))
      : undefined;
  const text = JSON.stringify(
    {
      diagnosticVersion: 1,
      sessionId: session.id,
      recordingId: session.recordingId,
      mode: session.mode,
      status: session.status,
      sessionError: session.error && /^[A-Z][A-Z0-9_]{1,79}$/.test(session.error) ? session.error : undefined,
      epoch: session.epoch,
      revision: session.revision,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      modelCalls: session.modelCalls,
      responseRecoveryCalls: session.responseRecoveryCalls ?? 0,
      lastResponse: session.responses?.at(-1),
      error: {
        source,
        code: errorCode,
        recovered: toolDiagnostic?.recovered,
        message: errorMessage,
        access,
        toolCallId: toolCallId && /^[a-zA-Z0-9_.:-]{1,128}$/.test(toolCallId) ? toolCallId : undefined,
        toolName: toolName && /^[a-z_]{1,80}$/.test(toolName) ? toolName : undefined,
        messageIndex,
        partIndex,
        issues: validationIssues,
      },
    },
    null,
    2
  );
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const generation = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    clearTimeout(resetTimer.current);
    setState('idle');
    return () => {
      generation.current++;
      clearTimeout(resetTimer.current);
    };
  }, [text]);
  /**
   * Acknowledges only a successful clipboard write for this diagnostic, never a failed or stale request.
   */
  async function copy() {
    const request = ++generation.current;
    clearTimeout(resetTimer.current);
    setState('copying');
    try {
      await navigator.clipboard.writeText(text);
      if (request === generation.current) {
        setState('copied');
        resetTimer.current = setTimeout(() => {
          if (request === generation.current) {
            setState('idle');
          }
        }, 1500);
      }
    } catch {
      if (request === generation.current) {
        setState('failed');
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span role="status" className="text-xs">
        {state === 'failed' ? '复制失败，请重试。' : state === 'copied' ? '诊断信息已复制。' : ''}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        title="复制错误信息和会话 ID"
        aria-label="复制诊断"
        disabled={state === 'copying'}
        onClick={() => void copy()}
      >
        {state === 'copied' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {state === 'copied' ? '已复制' : '复制诊断'}
      </Button>
    </div>
  );
}
