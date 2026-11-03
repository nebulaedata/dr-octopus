/**
 * @author Codex
 * @description Renders the page-owned recording controls with drag, collapse and globally scoped pause/stop.
 */
import { useEffect, useState } from 'react';
import {
  CableIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
} from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { recordingDuration, type RecordingSession } from '../../lib/recording/recording-contract';

/**
 * Projects the authoritative recording snapshot without owning its capture lifecycle.
 */
export function RecordingToolbar({
  session,
  error,
  control,
  host,
}: {
  session: RecordingSession | null;
  error: string;
  control: (action: 'pause' | 'resume' | 'stop') => Promise<void>;
  host: HTMLElement;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    /**
     * Repositions the overlay when expansion or viewport resizing would put controls off-screen.
     */
    function keepVisible() {
      const bounds = host.getBoundingClientRect();
      const left = Math.max(0, Math.min(document.documentElement.clientWidth - bounds.width, bounds.left));
      const top = Math.max(0, Math.min(document.documentElement.clientHeight - bounds.height, bounds.top));
      if (left !== bounds.left) {
        host.style.right = 'auto';
        host.style.left = `${left}px`;
      }
      if (top !== bounds.top) {
        host.style.top = `${top}px`;
      }
    }
    const observer = new ResizeObserver(keepVisible);
    observer.observe(host);
    window.addEventListener('resize', keepVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', keepVisible);
    };
  }, [host]);
  if (!session) {
    return null;
  }
  const paused = session.status !== 'recording';
  /**
   * Prevents duplicate user commands while keeping a rejected action visibly recoverable.
   */
  async function act(action: 'pause' | 'resume' | 'stop') {
    setBusy(true);
    try {
      await control(action);
    } finally {
      setBusy(false);
    }
  }
  /**
   * Moves only the overlay through captured pointer events, clamped to the visible viewport.
   */
  function drag(event: React.PointerEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    const start = host.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    /**
     * Preserves an accessible on-screen handle even in a narrow viewport.
     */
    const move = (next: PointerEvent) => {
      host.style.right = 'auto';
      host.style.left = `${Math.max(0, Math.min(document.documentElement.clientWidth - host.offsetWidth, start.left + next.clientX - x))}px`;
      host.style.top = `${Math.max(0, Math.min(document.documentElement.clientHeight - host.offsetHeight, start.top + next.clientY - y))}px`;
    };
    /**
     * Removes capture listeners after release, cancel or lost pointer capture.
     */
    const end = () => {
      button.removeEventListener('pointermove', move);
      button.removeEventListener('lostpointercapture', end);
    };
    button.addEventListener('pointermove', move);
    button.addEventListener('lostpointercapture', end, { once: true });
  }
  return (
    <section
      className="flex max-w-full flex-col gap-2 rounded-xl border bg-background p-2 text-foreground shadow-lg"
      aria-label="Dr.Octopus 录制工具栏"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="拖动录制工具栏"
          title="拖动录制工具栏"
          className="touch-none cursor-move"
          onPointerDown={drag}
        >
          <GripVerticalIcon />
        </Button>
        {!collapsed && <CableIcon className="size-4" aria-hidden="true" />}
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <span
            className={
              paused ? 'size-2 rounded-full bg-muted-foreground' : 'size-2 rounded-full bg-destructive'
            }
          />
          {paused ? '已暂停' : '录制中'}
        </span>
        <span className="text-xs tabular-nums">{recordingDuration(session, now)}</span>
        {!collapsed && (
          <span className="text-xs text-muted-foreground">
            {session.actionCount} 步 · {session.pages.filter((page) => page.included).length} 个页面
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title={paused ? '继续录制' : '暂停录制'}
          aria-label={paused ? '继续录制' : '暂停录制'}
          onClick={() => {
            void act(paused ? 'resume' : 'pause');
          }}
        >
          {paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
          {!collapsed && (paused ? '继续' : '暂停')}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          title="停止并保存"
          aria-label="停止并保存"
          onClick={() => {
            void act('stop');
          }}
        >
          <SquareIcon data-icon="inline-start" />
          {!collapsed && '停止保存'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? '展开工具栏' : '收起工具栏'}
          title={collapsed ? '展开工具栏' : '收起工具栏'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      {paused && !error && <p className="px-2 text-xs text-muted-foreground">暂停期间的操作不会记录</p>}
      {error && (
        <p role="alert" className="max-w-96 px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
