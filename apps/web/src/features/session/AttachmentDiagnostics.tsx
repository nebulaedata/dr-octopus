/**
 * @author Codex
 * @description Presents attachment coverage copy in a reusable hover preview without expanding the attachment rail.
 */
import { Button } from '@octopus/ui/components/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@octopus/ui/components/hover-card';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Keeps the trigger compact and allows long diagnostic content to wrap and scroll inside the viewport.
 */
export function AttachmentDiagnostics({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <HoverCard>
      <HoverCardTrigger render={<Button type="button" variant="link" size="xs" className="h-auto p-0" />}>
        {t('session.attachmentDiagnostics.trigger', 'Extraction details')}
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="flex flex-col gap-2 min-w-56 max-w-[calc(100vw-2rem)] max-h-64 overflow-y-auto whitespace-normal wrap-break-word"
      >
        <p className="font-semibold text-sm">
          {t('session.attachmentDiagnostics.title', 'Text extraction coverage')}
        </p>
        <p className="text-muted-foreground text-xs whitespace-pre-line wrap-anywhere">{text}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
