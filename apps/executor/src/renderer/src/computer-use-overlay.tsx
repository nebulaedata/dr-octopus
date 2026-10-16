/**
 * @author Codex
 * @description Renders read-only edge feedback in the isolated, click-through overlay document.
 */
import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import { Badge } from '@octopus/ui/components/badge';
import { cn } from '@octopus/ui/lib/utils';
import { MousePointer2, CircleAlert } from 'lucide-react';
import '@octopus/ui/globals.css';
import './computer-use-overlay.css';

/**
 * Subscribes to trusted Main state updates without reloading the overlay document or restarting its animations.
 */
function subscribeToState(notify: () => void): () => void {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/**
 * Reads only the finite read-only fragment; no page message or control command can start Computer use.
 */
function readUnknown(): boolean {
  return location.hash === '#unknown';
}

/**
 * Composes persistent display edges and the existing shadcn status badge, keeping the screen center transparent.
 */
function ComputerUseOverlay() {
  const unknown = useSyncExternalStore(subscribeToState, readUnknown);
  return (
    <div className="computer-overlay" data-state={unknown ? 'unknown' : 'running'}>
      <div className="ribbon" aria-hidden="true" />
      <div className="indicator-label" role="status">
        <Badge
          variant={unknown ? 'warning' : 'default'}
          className={cn(
            'h-auto gap-2 rounded-full px-4 py-2 shadow-lg shadow-foreground/15',
            !unknown && 'animate-pulse motion-reduce:animate-none'
          )}
        >
          {unknown ? <CircleAlert data-icon="inline-start" /> : <MousePointer2 data-icon="inline-start" />}
          {unknown
            ? '电脑控制状态未知 · 按 Esc 停止并确认后台退出'
            : 'Computer Use 进行中 · 按 Esc 停止桌面控制'}
        </Badge>
      </div>
    </div>
  );
}
const root = document.getElementById('root');
if (!root) {
  throw new Error('Computer indicator mount missing.');
}
createRoot(root).render(<ComputerUseOverlay />);
