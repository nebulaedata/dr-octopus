/**
 * @author Codex
 * @description Presents permission decisions with consistent semantic colors and readable text across Settings.
 */
import { Badge } from '@octopus/ui/components/badge';
import { actionLabel } from './permission-labels';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Distinguish allowed, review-required and denied actions while retaining neutral default labels.
 */
export function PermissionActionBadge({ action }: { action?: string }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={action === 'deny' ? 'destructive' : action === 'ask' ? 'warning' : 'secondary'}
      className={action === 'allow' ? 'bg-success/10 text-success' : undefined}
    >
      {actionLabel(t, action)}
    </Badge>
  );
}
