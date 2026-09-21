/**
 * @author Codex
 * @description Renders a durable model or Provider failure inside its originating conversation turn.
 */

import { Alert, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Presents the model failure returned by Pi even when the assistant produced no response content.
 *
 * @param props - User-facing error text normalized from the assistant message.
 * @returns A destructive inline failure notice anchored to the failed turn.
 */
export function MessageFailure({ errorMessage }: { errorMessage: string }) {
  const { t } = useI18n();
  return (
    <Alert variant="destructive" className="my-2">
      <AlertTitle>{t('session.messageFailure.title', 'Model request failed')}</AlertTitle>
      <AlertDescription className="break-words">{errorMessage}</AlertDescription>
    </Alert>
  );
}
