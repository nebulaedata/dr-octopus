/**
 * @author Codex
 * @description Centers a spinner with an optional localized loading message for lazy route and module boundaries.
 */
import { Spinner } from '@octopus/ui/components/spinner';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Renders the caller-supplied message or the shared default loading copy.
 */
export function LoadingFallback(props: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="grid h-full min-h-96 place-items-center text-sm text-muted-foreground">
      <span className="flex flex-col items-center gap-2">
        <Spinner />
        {props.message ?? t('common.loading', 'Loading…')}
      </span>
    </div>
  );
}
