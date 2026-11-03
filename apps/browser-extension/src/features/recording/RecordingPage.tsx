/**
 * @author Codex
 * @description Owns recording-page subscriptions and navigation independently of the extension popup shell.
 */
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Alert } from '@octopus/custom-ui/components/alert';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { PopupPage } from '../../components/PopupPage';
import { Box } from '../../components/Box';
import { RecordingPanel } from './RecordingPanel';
import { RecordingDetail } from './RecordingDetail';
import { RecordingList, type RecordingListChange } from './RecordingList';
import { sendRecordingRequest as send } from '../../lib/recording/recording-client';
import { skillRequest } from '../../lib/builtin-agent/skill-client';
import type { RecordingSkillState } from '../../lib/builtin-agent/skill-messages';
import {
  recordingError,
  type RecordingRequest,
  type RecordingView,
  type RecordingSession,
  type RecordedEvent,
} from '../../lib/recording/recording-contract';

/**
 * Displays recording state and record details without hosting other extension features.
 */
export function RecordingPage({
  openSkill,
}: {
  openSkill?: (mode: 'organize' | 'replay', recordingId: string, sessionId?: string) => void;
}) {
  const [view, setView] = useState<RecordingView | null>(null);
  const [skillStates, setSkillStates] = useState<Record<string, RecordingSkillState>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [detail, setDetail] = useState<{ session: RecordingSession; events: RecordedEvent[] } | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [listChange, setListChange] = useState<RecordingListChange | null>(null);
  const alive = useRef(true);
  const revision = useRef(0);
  const changing = useRef(false);

  /**
   * Applies only the latest authoritative refresh while this popup remains mounted.
   */
  async function refresh() {
    const next = ++revision.current;
    try {
      const [result, skills] = await Promise.allSettled([
        send<RecordingView>({ type: 'recorder.status' }),
        skillRequest<RecordingSkillState[]>({ type: 'skill.recordings' }),
      ]);
      if (alive.current && next === revision.current) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
        setView(result.value);
        if (skills.status === 'fulfilled') {
          setSkillStates(Object.fromEntries(skills.value.map((state) => [state.recordingId, state])));
        } else {
          setError('暂时无法读取技能状态。');
        }
      }
    } catch (failure) {
      if (alive.current && next === revision.current) {
        setError(recordingError(failure instanceof Error ? failure.message : 'RECORDING_DELIVERY'));
      }
    }
  }

  useEffect(() => {
    alive.current = true;
    /**
     * Refreshes on worker publication without treating the publication marker as state authority.
     */
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && (changes.recordingRevision || changes.skillRevision)) {
        void refresh();
      }
    };
    browser.storage.onChanged.addListener(changed);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    void refresh();
    return () => {
      alive.current = false;
      revision.current++;
      clearInterval(timer);
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);

  /**
   * Serializes visible actions and reloads terminal details only after confirmed persistence.
   */
  async function act(request: RecordingRequest) {
    if (changing.current) {
      return;
    }
    changing.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await send<unknown>(request);
      if (!alive.current) {
        return;
      }
      if (request.type === 'recorder.detail') {
        const data = result as { session?: RecordingSession; events: RecordedEvent[] };
        if (!data.session) {
          setDetail(null);
        } else {
          setDetail((previous) => ({
            session: data.session!,
            events:
              request.after && previous?.session.id === data.session!.id
                ? [...previous.events, ...data.events]
                : data.events,
          }));
        }
      } else if (request.type === 'recorder.delete') {
        setListChange({ id: request.sessionId, removed: true });
        setDetail(null);
      } else if (request.type === 'recorder.rename') {
        setListChange({ id: request.sessionId, name: request.name });
        setDetail((previous) =>
          previous ? { ...previous, session: { ...previous.session, name: request.name } } : null
        );
      } else if (request.type === 'recorder.control' && request.action === 'stop') {
        const session = result as RecordingSession;
        const data = await send<{ session: RecordingSession; events: RecordedEvent[] }>({
          type: 'recorder.detail',
          sessionId: session.id,
          after: 0,
        });
        if (alive.current) {
          setDetail(data);
        }
      }
      await refresh();
      // Keep popup visible until capture membership has been established; users may close it at any time.
    } catch (failure) {
      if (alive.current) {
        setError(recordingError(failure instanceof Error ? failure.message : 'RECORDING_DELIVERY'));
      }
    } finally {
      changing.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="录制管理">
      {error && (
        <Box className="shrink-0 pb-0">
          <Alert variant="danger" showIcon title="操作未完成" description={error} />
        </Box>
      )}
      {!view && (
        <Box>
          <Skeleton className="h-48 w-full" aria-label="读取录制状态" />
        </Box>
      )}
      {view && !detail && !allOpen && (
        <PopupPage scrollLabel="录制首页内容">
          <RecordingPanel
            view={view}
            skillStates={skillStates}
            showAll={() => setAllOpen(true)}
            busy={busy}
            now={now}
            command={(request) => {
              void act(request);
            }}
            open={(id) => {
              void act({ type: 'recorder.detail', sessionId: id, after: 0 });
            }}
          />
        </PopupPage>
      )}
      {allOpen && (
        <div hidden={detail !== null} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RecordingList
            skillStates={skillStates}
            back={() => setAllOpen(false)}
            open={(id) => {
              void act({ type: 'recorder.detail', sessionId: id, after: 0 });
            }}
            change={listChange}
            visible={!detail}
          />
        </div>
      )}
      {detail && (
        <RecordingDetail
          key={detail.session.id}
          {...detail}
          openSkill={openSkill}
          busy={busy}
          back={() => setDetail(null)}
          more={() => {
            void act({
              type: 'recorder.detail',
              sessionId: detail.session.id,
              after: detail.events.at(-1)?.seq ?? 0,
            });
          }}
          rename={(name) => {
            void act({ type: 'recorder.rename', sessionId: detail.session.id, name });
          }}
          remove={() => {
            void act({ type: 'recorder.delete', sessionId: detail.session.id });
          }}
        />
      )}
    </section>
  );
}
