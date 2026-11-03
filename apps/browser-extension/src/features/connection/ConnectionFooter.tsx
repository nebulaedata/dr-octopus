/**
 * @author Codex
 * @description Displays fixed extension metadata and bounded, accessible clipboard feedback.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';

/**
 * Copies the full installation identifier while keeping the visible metadata compact.
 */
export function ConnectionFooter({
  version,
  installationId,
}: {
  version: string;
  installationId: string | null;
}) {
  const [feedback, setFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    setFeedback('idle');
    return () => {
      generation.current++;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [installationId]);

  /**
   * Shows success only after clipboard completion; stale writes cannot update a replaced footer.
   */
  async function copy() {
    if (!installationId) {
      return;
    }
    const request = ++generation.current;
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setFeedback('idle');
    try {
      await navigator.clipboard.writeText(installationId);
      if (request !== generation.current) {
        return;
      }
      setFeedback('copied');
      timer.current = setTimeout(() => {
        if (request === generation.current) {
          setFeedback('idle');
        }
      }, 1500);
    } catch {
      if (request === generation.current) {
        setFeedback('failed');
      }
    }
  }

  return (
    <footer className="flex flex-col gap-1.5 text-xs text-muted-foreground" aria-label="扩展信息">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span>扩展版本</span>
        <span>v{version}</span>
      </div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="shrink-0">安装实例</span>
        <div className="flex min-w-0 items-center gap-1">
          <code className="truncate text-[11px]" title={installationId ?? undefined}>
            {installationId ? `${installationId.slice(0, 8)}…${installationId.slice(-4)}` : '—'}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!installationId}
            onClick={() => {
              void copy();
            }}
            aria-label={feedback === 'copied' ? '已复制安装实例' : '复制安装实例'}
            title={feedback === 'copied' ? '已复制' : '复制完整安装实例'}
          >
            {feedback === 'copied' ? (
              <CheckIcon className="text-success" aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <span role="status" className={feedback === 'failed' ? 'text-destructive' : 'sr-only'}>
        {feedback === 'copied' && '安装实例已复制'}
        {feedback === 'failed' && '复制失败，请重试。'}
      </span>
    </footer>
  );
}
