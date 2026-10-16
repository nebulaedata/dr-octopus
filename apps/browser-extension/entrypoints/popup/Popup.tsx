/**
 * @author Codex
 * @description Displays live worker connection evidence and finite pause/reconnect actions through shared shadcn primitives.
 */
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  CableIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  InfoIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  UnplugIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@octopus/ui/components/card';
import { Skeleton } from '@octopus/ui/components/skeleton';
import {
  popupStatusSchema,
  statusDescription,
  type PopupRequest,
  type PopupStatus,
} from '../../src/popup-bridge';

const labels = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  paused: '已暂停',
  incompatible: '版本不兼容',
};
const icons = {
  connected: CircleCheckIcon,
  connecting: LoaderCircleIcon,
  disconnected: UnplugIcon,
  paused: CirclePauseIcon,
  incompatible: InfoIcon,
};

/**
 * Owns only popup subscriptions and requests; closing the popup leaves the background connection alive.
 */
export function Popup() {
  const [status, setStatus] = useState<PopupStatus | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const active = useRef(true);
  const actionPending = useRef(false);
  const manifest = browser.runtime.getManifest();
  const browserName = import.meta.env.BROWSER === 'edge' ? 'Microsoft Edge' : 'Google Chrome';

  /**
   * Validates each reply and prevents earlier asynchronous reads from overwriting newer worker evidence.
   */
  async function readStatus(request: PopupRequest = { type: 'bridge.status' }) {
    const current = ++revision.current;
    try {
      const reply = popupStatusSchema.parse(await browser.runtime.sendMessage(request));
      if (active.current && current === revision.current) {
        setStatus(reply);
        setError(false);
      }
    } catch {
      if (active.current && current === revision.current) {
        setStatus(null);
        setError(true);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    /**
     * Reuses the shared dark theme and follows the browser's system preference while this popup is open.
     */
    const applyTheme = () => document.documentElement.classList.toggle('dark', theme.matches);
    applyTheme();
    theme.addEventListener('change', applyTheme);
    /**
     * Refreshes from the worker when persisted notifications change, without accepting persisted connected labels.
     */
    const changed = (_changes: unknown, area: string) => {
      if (area === 'local') {
        void readStatus();
      }
    };
    browser.storage.onChanged.addListener(changed);
    const interval = setInterval(() => void readStatus(), 2000);
    void readStatus();
    return () => {
      active.current = false;
      revision.current++;
      clearInterval(interval);
      theme.removeEventListener('change', applyTheme);
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);

  /**
   * Serializes user connection controls while the worker keeps ownership of retries and Native Messaging.
   */
  async function control(request: PopupRequest) {
    if (actionPending.current) {
      return;
    }
    actionPending.current = true;
    setBusy(true);
    await readStatus(request);
    actionPending.current = false;
    if (active.current) {
      setBusy(false);
    }
  }

  let StatusIcon = CableIcon;
  if (status) {
    StatusIcon = icons[status.phase];
  }
  const paused = status?.phase === 'paused';
  let refreshLabel = '重新连接';
  if (error) {
    refreshLabel = '重试';
  } else if (status?.phase === 'connected') {
    refreshLabel = '刷新状态';
  }

  return (
    <main className="flex flex-col gap-4 bg-background p-4 text-foreground">
      <header className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <CableIcon className="size-5" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold">Dr.Octopus</h1>
          <p className="text-xs text-muted-foreground">浏览器连接 · {browserName}</p>
        </div>
      </header>
      <Card size="sm">
        <CardHeader>
          <CardTitle>本机 Executor</CardTitle>
          <CardDescription>通过此扩展连接当前浏览器</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4" aria-live="polite">
          {status && (
            <>
              <dl className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">连接状态</dt>
                  <dd>
                    <Badge variant={status.phase === 'connected' ? 'default' : 'secondary'}>
                      <StatusIcon aria-hidden="true" />
                      {labels[status.phase]}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">工具链</dt>
                  <dd>
                    <Badge variant="outline">{status.toolsReady ? '就绪' : '未就绪'}</Badge>
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">{statusDescription(status)}</p>
              {status.lastFailure ? (
                <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-xs">
                  <p className="font-medium">最近一次连接异常</p>
                  <p className="text-muted-foreground">{new Date(status.lastFailure.at).toLocaleString()}</p>
                  <p className="break-all font-mono">{status.lastFailure.code}</p>
                  {status.lastFailure.method ? (
                    <p className="break-all font-mono">{status.lastFailure.method}</p>
                  ) : null}
                  {status.lastFailure.nativeReason ? (
                    <p className="font-mono">{status.lastFailure.nativeReason}</p>
                  ) : null}
                  <p className="text-muted-foreground">重连后仍保留此记录，不代表当前连接失败。</p>
                </div>
              ) : null}
            </>
          )}
          {!status && !error && <Skeleton className="h-24 w-full" aria-label="正在读取连接状态" />}
          {error && (
            <Alert variant="destructive">
              <InfoIcon aria-hidden="true" />
              <AlertTitle>无法读取状态</AlertTitle>
              <AlertDescription>请重试；若仍失败，请在扩展管理页重新加载扩展。</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            className="flex-1"
            disabled={busy || paused || status?.phase === 'connecting'}
            onClick={() =>
              void control({ type: status?.phase === 'connected' ? 'bridge.status' : 'bridge.reconnect' })
            }
          >
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            {refreshLabel}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy || !status}
            onClick={() => void control({ type: 'bridge.pause', paused: !paused })}
          >
            {paused ? (
              <PlayIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <PauseIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {paused ? '恢复连接' : '暂停连接'}
          </Button>
        </CardFooter>
      </Card>
      <footer className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>扩展版本</span>
          <span>v{manifest.version}</span>
        </div>
        {status?.installationId && (
          <div className="flex flex-col gap-1">
            <span>安装实例</span>
            <code className="break-all text-[11px]">{status.installationId}</code>
          </div>
        )}
      </footer>
    </main>
  );
}
