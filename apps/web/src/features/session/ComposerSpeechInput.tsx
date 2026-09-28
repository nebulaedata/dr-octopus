/**
 * @author Codex
 * @description Keeps one toolbar microphone entry and presents capture, waveform and transcription controls in a focused dialog.
 */
import { MicIcon, SquareIcon, XIcon, AudioLinesIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { Kbd } from '@octopus/ui/components/kbd';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@octopus/ui/components/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { ElapsedTime, formatDuration } from '@octopus/custom-ui/components/elapsed-time';
import { speechMaxRecordingMs } from '@octopus/shared/protocol';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { useShortcutBinding } from '@/hooks/use-shortcut';
import { ShortcutKeyRegister, toAriaKeyShortcuts } from '@/lib/shortcuts';
import { useSpeechWaveform } from './hooks/use-speech-waveform';
import type { useSpeechInput } from './hooks/use-speech-input';

/**
 * Gives recording its own modal surface while preserving configurable keyboard actions and draft focus.
 */
export function ComposerSpeechInput({
  speech,
  disabled,
  onReturnFocus,
}: {
  speech: ReturnType<typeof useSpeechInput>;
  disabled: boolean;
  /**
   * Restores the editor caret after cancellation or successful transcription.
   */
  onReturnFocus(): void;
}) {
  const { t } = useI18n();
  const toggleBinding = useShortcutBinding(ShortcutKeyRegister.VOICE_TOGGLE);
  const cancelBinding = useShortcutBinding(ShortcutKeyRegister.VOICE_CANCEL);
  const busy = speech.state !== 'idle';
  const recording = speech.state === 'recording';
  const transcribing = speech.state === 'transcribing';
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled || busy}
              aria-label="Start voice input"
              aria-haspopup="dialog"
              aria-expanded={busy}
              aria-keyshortcuts={toggleBinding ? toAriaKeyShortcuts(toggleBinding) : undefined}
              onClick={() => void speech.start()}
            >
              <MicIcon />
            </Button>
          }
        />
        <TooltipContent className="flex items-center gap-2">
          {t('speech.start', 'Voice input')}
          {toggleBinding && <Kbd>{toggleBinding.replaceAll('+', ' + ')}</Kbd>}
        </TooltipContent>
      </Tooltip>
      <Dialog
        open={busy}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) {
            speech.cancel();
          }
        }}
      >
        <DialogContent
          data-speech-dialog
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] auto-rows-max gap-6 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl p-6 sm:max-w-sm motion-reduce:animate-none"
          finalFocus={() => {
            onReturnFocus();
            return false;
          }}
        >
          <DialogHeader className="items-center text-center">
            <DialogTitle>{t('speech.start', 'Voice input')}</DialogTitle>
            <DialogDescription>
              {t('speech.dialogHelp', 'Speak naturally. Your words will become an editable draft.')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div
              aria-hidden="true"
              className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              {recording && (
                <span className="absolute inset-0 rounded-full border border-primary/20 motion-safe:animate-ping animation-duration-[2.5s]" />
              )}
              {transcribing ? (
                <AudioLinesIcon className="size-7 motion-safe:animate-pulse" />
              ) : (
                <MicIcon className="size-7" />
              )}
            </div>
            <SpeechWaveform stream={speech.stream} transcribing={transcribing} />
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              aria-label="Recording duration"
            >
              <span
                aria-hidden="true"
                className={cn('size-1.5 rounded-full', recording ? 'bg-primary' : 'bg-muted-foreground')}
              />
              <ElapsedTime elapsedMs={speech.elapsedMs} running={recording} format="clock" refreshMs={1000} />
              <span>{`/ ${formatDuration(speechMaxRecordingMs, 'clock')}`}</span>
            </div>
          </div>
          <div role="status" className="min-h-10 text-center text-sm">
            {speech.state === 'requesting' && t('speech.requesting', 'Waiting for microphone permission…')}
            {recording && t('speech.listening', 'Recording… I’m listening.')}
            {transcribing && t('speech.transcribing', 'Recognizing speech…')}
            {recording && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('speech.recordingHint', 'Stop when you’re finished. Up to 2 minutes.')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {recording && (
              <Button
                type="button"
                size="lg"
                className="h-auto min-h-9 flex-wrap gap-x-3 gap-y-1.5 py-2 whitespace-normal"
                aria-label="Stop recording and transcribe"
                aria-keyshortcuts={toggleBinding ? toAriaKeyShortcuts(toggleBinding) : undefined}
                onClick={speech.stop}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <SquareIcon data-icon="inline-start" />
                  {t('speech.stop', 'Stop and transcribe')}
                </span>
                {toggleBinding && (
                  <Kbd className="bg-accent font-geist text-accent-foreground">
                    {toggleBinding.replaceAll('+', ' + ')}
                  </Kbd>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-8 flex-wrap gap-x-3 gap-y-1.5 py-2 whitespace-normal"
              aria-label="Cancel voice input"
              aria-keyshortcuts={cancelBinding ? toAriaKeyShortcuts(cancelBinding) : undefined}
              onClick={speech.cancel}
            >
              <span className="flex items-center justify-center gap-1.5">
                <XIcon data-icon="inline-start" />
                {t('speech.cancel', 'Cancel voice input')}
              </span>
              {cancelBinding && (
                <Kbd className="bg-accent font-geist text-accent-foreground">
                  {cancelBinding.replaceAll('+', ' + ')}
                </Kbd>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Mounts the analyser with the dialog's visual content, never opening another microphone stream.
 */
function SpeechWaveform({ stream, transcribing }: { stream: MediaStream | null; transcribing: boolean }) {
  const ref = useSpeechWaveform(stream);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-speech-waveform
      className="flex h-20 w-full items-center justify-center gap-1 overflow-hidden"
    >
      {Array.from({ length: 31 }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-16 min-w-0 flex-1 rounded-full bg-primary/70',
            transcribing && 'motion-safe:animate-pulse'
          )}
          style={{
            transform: `scaleY(${0.12 + 0.3 * Math.sin(index * 0.8) ** 2})`,
            animationDelay: `${index * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}
