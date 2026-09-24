/**
 * @author Codex
 * @description Owns Session properties, queue visibility, cloning, export, and persisted behavior preferences.
 */

import { copyTextWithFeedback } from '@/utils/copy-text-with-feedback';
import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CopyIcon, DownloadIcon, InfoIcon, Layers2Icon, Settings2Icon } from 'lucide-react';
import { useStore } from 'zustand';
import { Badge } from '@octopus/ui/components/badge';
import { Button, buttonVariants } from '@octopus/ui/components/button';
import { cn } from '@octopus/ui/lib/utils';
import { Separator } from '@octopus/ui/components/separator';
import { Switch } from '@octopus/ui/components/switch';
import { useDeriveSession, useUpdateSessionPreferences } from '@/queries/session-queries';
import { getSessionExportUrl } from '@/api/sessions';
import { useRealtimeCommand } from '@/hooks/use-realtime';
import { useI18n } from '@/i18n/use-i18n';
import { sessionStores } from '@/stores/session';
import { SideRightPanel } from '@/components/SideRightPanel';
import { SessionStatsSection } from './SessionStatsSection';
import type { SessionDto } from '@octopus/shared/protocol';
import type { RealtimeConnectionState } from '@/hooks/use-realtime';

/**
 * Coordinates controls that affect durable Session metadata rather than the transcript.
 */
export function PropertiesPanel({
  session,
  connection,
  runtimeId,
  epoch,
  visible,
  onClose,
  onNavigate,
}: {
  session: SessionDto;
  connection: RealtimeConnectionState;
  runtimeId?: string;
  epoch?: number;
  visible?: boolean;
  onClose?(): void;
  onNavigate(workspaceId: string, sessionId: string): void;
}) {
  const { t } = useI18n();
  const store = sessionStores.ensure(session.id);
  const queue = useStore(store, (state) => state.queue);
  const thinkingLevel = useStore(store, (state) => state.thinking.level);
  const retryAbortable = useStore(store, (state) => {
    const turn = state.activeTurnId === undefined ? undefined : state.turnsById[state.activeTurnId];
    return turn?.retries?.some((retry) => retry.id === state.activeRetryId && retry.status === 'waiting');
  });
  const send = useRealtimeCommand();
  const exportUrl = getSessionExportUrl(session.workspaceId, session.id);
  const updatePreferences = useUpdateSessionPreferences(session);
  const derive = useDeriveSession(session);

  useEffect(() => {
    if (derive.data?.session !== undefined) {
      onNavigate(derive.data.session.workspaceId, derive.data.session.id);
    }
  }, [derive.data, onNavigate]);

  useEffect(() => {
    if (derive.error !== null) {
      store.getState().setError(derive.error.message);
    }
  }, [derive.error, store]);
  const pendingCount = queue.steering.length + queue.followUp.length;

  /**
   * Persists one preference and reconciles the HTTP projection.
   */
  if (visible) {
    return (
      <SideRightPanel title={t('layout.session.propertiesPanel', 'Properties Panel')} onClose={onClose}>
        <div className="flex flex-col gap-3.5 px-0.5 pt-2.5 pb-4.5">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{t('session.properties.queue', 'Queue')}</span>
            <Badge variant="secondary">{pendingCount}</Badge>
          </div>
          {pendingCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('session.properties.noPending', 'No pending messages')}
            </p>
          ) : (
            <p className="text-sm">
              {t('session.properties.queueSummary', '{{steering}} steering · {{followUp}} follow-up', {
                steering: queue.steering.length,
                followUp: queue.followUp.length,
              })}
            </p>
          )}
        </div>
        <Separator />
        <div className="flex flex-col gap-3.5 px-0.5 py-4.5">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{t('session.properties.detailsTitle', 'Session details')}</span>
            <InfoIcon className="size-4 text-muted-foreground" />
          </div>
          <Definition label={t('session.properties.sessionId', 'Session ID')} value={session.id} />
          <Definition label={t('session.properties.workspace', 'Workspace')} value={session.workspaceId} />
          <Definition label={t('session.properties.connection', 'Connection')} value={connection} />
          {session.agentSessionPath && (
            <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2.5 text-xs">
              <dt className="text-muted-foreground">{t('session.properties.agentFile', 'Agent file')}</dt>
              <dd
                className="flex items-center justify-end gap-1.5 truncate text-right"
                title={session.agentSessionPath}
              >
                <span className="truncate">{session.agentSessionPath}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Copy agent session path"
                  title={t('session.properties.copyPathTitle', 'Copy path')}
                  onClick={() => copyTextWithFeedback(session.agentSessionPath!)}
                >
                  <CopyIcon className="size-3" />
                </Button>
              </dd>
            </div>
          )}
          <Definition
            label={t('session.properties.model', 'Model')}
            value={session.model ?? t('session.properties.runtimeDefault', 'Runtime default')}
          />
          <Definition label={t('session.properties.thinking', 'Thinking')} value={thinkingLevel} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={derive.isPending}
              onClick={() => derive.mutate('clone')}
            >
              <Layers2Icon data-icon="inline-start" />
              {t('session.properties.clone', 'Clone')}
            </Button>
            <a className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={exportUrl} download>
              <DownloadIcon data-icon="inline-start" />
              <span>{t('session.properties.exportHtml', 'Export HTML')}</span>
            </a>
          </div>
        </div>
        <Separator />
        {!session.execution && (
          <>
            <SessionStatsSection session={session} />
            <Separator />
          </>
        )}
        <div className="flex flex-col gap-3.5 px-0.5 py-4.5">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{t('session.properties.behaviorTitle', 'Behavior')}</span>
            <Settings2Icon className="size-4 text-muted-foreground" />
          </div>
          <SettingRow
            label={t('session.properties.autoCompaction', 'Auto compaction')}
            checked={session.preferences.autoCompactionEnabled}
            onCheckedChange={(checked) => updatePreferences.mutate({ autoCompactionEnabled: checked })}
          />
          <SettingRow
            label={t('session.properties.autoRetry', 'Auto retry')}
            checked={session.preferences.autoRetryEnabled}
            onCheckedChange={(checked) => updatePreferences.mutate({ autoRetryEnabled: checked })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                send({
                  type: 'agent.compact',
                  requestId: uuidv4(),
                  sessionId: session.id,
                  runtimeId,
                  epoch,
                })
              }
            >
              {t('session.properties.compact', 'Compact')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!retryAbortable}
              onClick={() =>
                send({
                  type: 'agent.abort-retry',
                  requestId: uuidv4(),
                  sessionId: session.id,
                  runtimeId,
                  epoch,
                })
              }
            >
              {t('session.properties.stopRetry', 'Stop retry')}
            </Button>
          </div>
        </div>
      </SideRightPanel>
    );
  }

  return null;
}

/**
 * Presents one Session metadata value.
 */
function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Couples an accessible label with one persisted boolean preference.
 */
function SettingRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange(value: boolean): void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
