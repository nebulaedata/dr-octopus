/**
 * @author Codex
 * @description Hosts SDK turns outside view navigation and presents the existing agent screens in a persistent window panel.
 */
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { CableIcon, SettingsIcon, HistoryIcon } from 'lucide-react';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { Button } from '@octopus/ui/components/button';
import { Alert } from '@octopus/custom-ui/components/alert';
import { cn } from '@octopus/ui/lib/utils';
import { Box } from '../../components/Box';
import { GlobalModelSettings } from '../model-settings/GlobalModelSettings';
import { ConversationList } from './ConversationList';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import type { SkillHistoryItem } from '../../lib/builtin-agent/skill-messages';
import { AgentSessionPage } from '../agent-session/AgentSessionPage';
import { windowPanelRouteSchema, type WindowPanelRoute } from '../../lib/builtin-agent/skill-messages';
import { runBuiltinAgent } from '../../lib/builtin-agent/builtin-host';

/**
 * Keeps models alive across in-panel settings/history navigation, but cancels them when the document closes.
 */
export function WindowPanel() {
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState('');
  const [windowId, setWindowId] = useState<number>();
  const [activeSessions, setActiveSessions] = useState<SkillHistoryItem[]>([]);
  const [route, setRoute] = useState<WindowPanelRoute>();
  const [autoStart, setAutoStart] = useState(false);
  const [settings, setSettings] = useState(false);
  const [visited, setVisited] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(new Map<string, AbortController>());
  /**
   * Views never create tasks or change the running SDK host.
   */
  function view(next?: WindowPanelRoute) {
    setAutoStart(false);
    setRoute(next);
    setSettings(false);
    void skillRequest({ type: 'skill.panel.view', route: next }).catch(() =>
      setError('会话位置未能保存，请重试。')
    );
  }
  const activeSession = activeSessions.find(
    (item) => item.windowId === windowId && item.id !== route?.sessionId
  );
  useEffect(() => {
    const changed = (changes: Record<string, unknown>) => {
      if (changes.skillRevision) {
        setRevision(crypto.randomUUID());
      }
    };
    browser.storage.onChanged.addListener(changed);
    const theme = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme.matches);
    apply();
    theme.addEventListener('change', apply);
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let port: ReturnType<typeof browser.runtime.connect>;
    const cancel = () => {
      for (const controller of active.current.values()) {
        controller.abort();
      }
      active.current.clear();
    };
    const connect = async () => {
      if (disposed) {
        return;
      }
      const current = await browser.windows.getCurrent();
      if (disposed || current.id === undefined) {
        return;
      }
      port = browser.runtime.connect({ name: 'octopus-window-panel:' + current.id });
      port.onMessage.addListener((message) => {
        if (message.type === 'panel.ready' || message.type === 'panel.route') {
          if (message.type === 'panel.ready') {
            setReady(true);
            setWindowId(message.windowId);
          }
          setError('');
          const parsed = windowPanelRouteSchema.safeParse(message.route);
          if (parsed.success) {
            setRoute((previous) => {
              if (message.type === 'panel.ready' || message.autoStart === true) {
                return parsed.data;
              }
              if (
                previous &&
                previous.recordingId === parsed.data.recordingId &&
                previous.mode === parsed.data.mode &&
                (!previous.sessionId || previous.sessionId === parsed.data.sessionId)
              ) {
                return parsed.data;
              }
              return previous;
            });
            setAutoStart(message.autoStart === true);
            if (message.autoStart === true) {
              setSettings(false);
            }
          }
        } else if (message.type === 'panel.run') {
          const key = message.id + ':' + message.epoch;
          if (active.current.has(key)) {
            return;
          }
          const controller = new AbortController();
          active.current.set(key, controller);
          void runBuiltinAgent(message.id, message.epoch, controller.signal).finally(() =>
            active.current.delete(key)
          );
        } else if (message.type === 'panel.abort') {
          active.current.get(message.id + ':' + message.epoch)?.abort();
        }
      });
      port.onDisconnect.addListener(() => {
        cancel();
        if (!disposed) {
          setError('运行连接已中断，正在重新连接；任务不会自动重试。');
          retry = setTimeout(connect, 1000);
        }
      });
    };
    const heartbeat = setInterval(() => {
      if (active.current.size && port) {
        try {
          port.postMessage({ type: 'panel.ping' });
        } catch {
          cancel();
        }
      }
    }, 20000);
    const leave = () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      cancel();
      port?.disconnect();
    };
    connect();
    window.addEventListener('pagehide', leave);
    return () => {
      leave();
      window.removeEventListener('pagehide', leave);
      theme.removeEventListener('change', apply);
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  return (
    <main className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <Box className="shrink-0">
        <header className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
            <CableIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Dr.Octopus</h1>
            <p className="text-xs text-muted-foreground">录制重放 · 智能体会话</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="会话历史"
            aria-label="会话历史"
            disabled={!ready}
            onClick={() => view()}
          >
            <HistoryIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="模型设置"
            aria-label="模型设置"
            onClick={() => {
              setVisited(true);
              setSettings(true);
            }}
          >
            <SettingsIcon />
          </Button>
        </header>
      </Box>
      {error && (
        <Box>
          <Alert variant="danger" description={error} />
        </Box>
      )}
      {activeSession && !settings && (
        <Box className="py-0">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() =>
              view({
                recordingId: activeSession.recordingId,
                mode: activeSession.mode,
                sessionId: activeSession.id,
              })
            }
          >
            <span className="truncate">
              {activeSession.status === 'waiting_user'
                ? '查看待回答会话'
                : activeSession.status === 'outcome_unknown'
                  ? '查看待核实会话'
                  : activeSession.status === 'saving'
                    ? '查看待保存会话'
                    : '返回进行中会话'}{' '}
              · {activeSession.name}
            </span>
          </Button>
        </Box>
      )}
      <div className={cn('min-h-0 flex-1 flex-col overflow-hidden', settings ? 'hidden' : 'flex')}>
        {!ready && (
          <Box>
            <Skeleton className="h-32" aria-label="正在读取会话" />
          </Box>
        )}
        {ready && (
          <div className={cn('min-h-0 flex-1 flex-col overflow-hidden', route ? 'hidden' : 'flex')}>
            <ConversationList
              visible={!route && !settings}
              revision={revision}
              onActive={setActiveSessions}
              open={(item) => view({ recordingId: item.recordingId, mode: item.mode, sessionId: item.id })}
            />
          </div>
        )}
        {ready && route && (
          <AgentSessionPage
            key={route.recordingId + ':' + route.mode + ':' + (route.sessionId ?? 'new')}
            {...route}
            autoStart={autoStart}
            back={() => view()}
            backLabel="返回会话历史"
            openSettings={() => {
              setVisited(true);
              setSettings(true);
            }}
          />
        )}
      </div>
      {visited && (
        <div className={cn('min-h-0 flex-1 flex-col overflow-hidden', settings ? 'flex' : 'hidden')}>
          <GlobalModelSettings visible={settings} back={() => setSettings(false)} />
        </div>
      )}
    </main>
  );
}
