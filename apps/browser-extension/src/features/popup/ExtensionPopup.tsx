/**
 * @author Codex
 * @description Hosts connection and recording/replay tabs without duplicating agent configuration.
 */
import { useEffect, useState } from 'react';
import { CableIcon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@octopus/ui/components/tabs';
import { cn } from '@octopus/ui/lib/utils';
import { ConnectionPanel } from '../connection';
import { RecordingPage } from '../recording';
import { browser } from 'wxt/browser';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Box } from '../../components/Box';
import type { PopupStatus } from '../../popup-bridge';

/**
 * Owns routes only; agents, recordings and Native connections remain background-owned.
 */
export function ExtensionPopup() {
  const [windowId, setWindowId] = useState<number>();
  const [panelError, setPanelError] = useState('');
  useEffect(() => {
    void browser.windows.getCurrent().then((value) => setWindowId(value.id));
  }, []);
  /**
   * Opens in the click gesture before awaiting storage or Worker messages.
   */
  function openSkill(mode: 'organize' | 'replay', recordingId: string, sessionId?: string) {
    if (windowId === undefined) {
      setPanelError('窗口尚未就绪，请重试。');
      return;
    }
    setPanelError('');
    const opened = browser.sidePanel.open({ windowId });
    // Send navigation before opening the native panel can dismiss this popup document.
    const routed = skillRequest({
      type: 'skill.panel.open',
      windowId,
      route: { mode, recordingId, sessionId },
    });
    void Promise.all([opened, routed]).catch(() => setPanelError('侧边栏未能打开，请重试。'));
  }
  const [tab, setTab] = useState('connection');
  const [connection, setConnection] = useState<PopupStatus | null>(null);
  useEffect(() => {
    const theme = matchMedia('(prefers-color-scheme: dark)');
    /**
     * Follows browser theme without overriding shared component semantic colors.
     */
    const applyTheme = () => document.documentElement.classList.toggle('dark', theme.matches);
    applyTheme();
    theme.addEventListener('change', applyTheme);
    return () => theme.removeEventListener('change', applyTheme);
  }, []);
  let connectionLabel = '正在获取连接状态';
  let dotColor = 'bg-muted-foreground';
  if (connection?.phase === 'connected') {
    connectionLabel = '连接成功';
    dotColor = 'bg-success';
  } else if (connection?.phase === 'disconnected' || connection?.phase === 'incompatible') {
    connectionLabel = '连接失败';
    dotColor = 'bg-destructive';
  } else if (connection?.phase === 'connecting') {
    connectionLabel = '连接中';
  } else if (connection?.phase === 'paused') {
    connectionLabel = '连接已暂停';
  }
  return (
    <main className="fixed inset-x-0 top-0 flex h-[600px] max-h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <Box className="shrink-0">
        <header className="flex shrink-0 items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
            <CableIcon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Dr.Octopus</h1>
            <p className="text-xs text-muted-foreground">
              浏览器连接 · {import.meta.env.BROWSER === 'edge' ? 'Microsoft Edge' : 'Google Chrome'}
            </p>
          </div>
        </header>
      </Box>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(String(value));
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <Box className="shrink-0 py-0">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="connection" aria-label="连接状态" title={connectionLabel}>
              连接状态
              <span
                role="img"
                aria-label={connectionLabel}
                data-slot="connection-status-dot"
                className={cn('size-1.5 shrink-0 rounded-full', dotColor)}
              />
            </TabsTrigger>
            <TabsTrigger value="recording">录制重放</TabsTrigger>
          </TabsList>
        </Box>
        <TabsContent
          value="connection"
          keepMounted
          className={cn('min-h-0 flex-1 flex-col overflow-hidden', tab === 'connection' ? 'flex' : 'hidden')}
        >
          <ConnectionPanel onStatusChange={setConnection} />
        </TabsContent>
        <TabsContent
          value="recording"
          keepMounted
          className={cn('min-h-0 flex-1 flex-col overflow-hidden', tab === 'recording' ? 'flex' : 'hidden')}
        >
          <RecordingPage openSkill={openSkill} />
          {panelError && (
            <Box>
              <Alert variant="danger" description={panelError} />
            </Box>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
