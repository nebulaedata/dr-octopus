/**
 * @author Codex
 * @description Coordinates microphone capture and cancellable ASR while preventing stale results from changing drafts.
 */
import { useEffect, useRef } from 'react';
import { useLatest, useMemoizedFn, useSafeState } from 'ahooks';
import { transcribeSpeech } from '@/api/speech';
import { useI18n } from '@/i18n/use-i18n';
import { SpeechRecorder } from '../utils/speech-recorder';

export type SpeechInputState = 'idle' | 'requesting' | 'recording' | 'transcribing';

/**
 * Owns one capture per Composer; disablement, session changes and unmount discard pending work.
 */
export function useSpeechInput(enabled: boolean, sessionId: string, onText: (text: string) => void) {
  const { t } = useI18n();
  const [state, setState] = useSafeState<SpeechInputState>('idle');
  const [error, setError] = useSafeState<string | null>(null);
  const [stream, setStream] = useSafeState<MediaStream | null>(null);
  const [elapsedMs, setElapsedMs] = useSafeState(0);
  const context = useLatest({ enabled, sessionId });
  const active = useRef<{ recorder: SpeechRecorder; controller: AbortController } | null>(null);
  const cancel = useMemoizedFn(() => {
    const previous = active.current;
    active.current = null;
    previous?.controller.abort();
    previous?.recorder.cancel();
    setState('idle');
    setStream(null);
    setElapsedMs(0);
    setError(null);
  });
  useEffect(() => {
    if (!enabled) {
      cancel();
    }
    return cancel;
  }, [enabled, sessionId, cancel]);
  const start = useMemoizedFn(async () => {
    if (!enabled || active.current) {
      return;
    }
    const operation = { recorder: new SpeechRecorder(), controller: new AbortController() };
    active.current = operation;
    setError(null);
    setState('requesting');
    setElapsedMs(0);
    let startedAt = 0;
    try {
      const audio = await operation.recorder.record((microphone) => {
        startedAt = Date.now();
        setStream(microphone);
        setState('recording');
      });
      if (
        !audio ||
        active.current !== operation ||
        !context.current.enabled ||
        context.current.sessionId !== sessionId
      ) {
        return;
      }
      setState('transcribing');
      setElapsedMs(Date.now() - startedAt);
      setStream(null);
      const result = await transcribeSpeech(audio, operation.controller.signal);
      if (
        active.current !== operation ||
        !context.current.enabled ||
        context.current.sessionId !== sessionId
      ) {
        return;
      }
      if (result.text.trim()) {
        onText(result.text);
      } else {
        setError(t('speech.noSpeech', 'No speech was recognized. Try recording again.'));
      }
    } catch (cause) {
      if (active.current !== operation) {
        return;
      }
      if (cause instanceof Error && cause.message === 'unsupported') {
        setError(t('speech.unsupported', 'Voice input requires a supported browser and HTTPS or localhost.'));
      } else if (
        cause instanceof Error &&
        ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(cause.name)
      ) {
        setError(
          t(
            'speech.microphoneError',
            'Could not access the microphone. Check browser permissions and your input device.'
          )
        );
      } else {
        setError(
          t(
            'speech.failed',
            'Voice input failed. Check the microphone and speech service settings, then try again.'
          )
        );
      }
    } finally {
      operation.recorder.cancel();
      if (active.current === operation) {
        active.current = null;
        setStream(null);
        setState('idle');
      }
    }
  });
  return {
    state,
    error,
    stream,
    elapsedMs,
    start,
    cancel,
    stop: useMemoizedFn(() => active.current?.recorder.stop()),
  };
}
