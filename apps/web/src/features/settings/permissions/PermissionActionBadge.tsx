/**
 * @author Codex
 * @description Presents permission decisions with consistent semantic colors and readable text across Settings.
 */
import { Badge } from '@octopus/ui/components/badge';
import { actionLabel } from '@/features/settings/utils/permission-labels';
import { useI18n } from '@/i18n/use-i18n';

/**
 * Distinguish allowed, review-required and denied actions while retaining neutral default labels.
 */
export function PermissionActionBadge({ action }: { action?: string }) {
  const { t } = useI18n();
  /**
   * Selects variant in the existing condition order.
   */
  function selectVariant() {
    if (action === 'deny') {
      return 'destructive' as const;
    } else if (action === 'ask') {
      return 'warning' as const;
    } else {
      return 'secondary' as const;
    }
  }
  return (
    <Badge
      variant={selectVariant()}
      className={action === 'allow' ? 'bg-success/10 text-success' : undefined}
    >
      {actionLabel(t, action)}
    </Badge>
  );
}
