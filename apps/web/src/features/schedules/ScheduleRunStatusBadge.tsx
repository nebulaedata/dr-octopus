/**
 * @author Codex
 * @description Shares semantic execution status colors across history and result pages.
 */
import { Badge } from '@octopus/ui/components/badge';
import { cn } from '@octopus/ui/lib/utils';

/**
 * Distinguishes successful, active, failed, attention and inactive runs without relying on color alone.
 */
export function ScheduleRunStatusBadge({ status, label }: { status: string; label: string }) {
  const failed = ['failed', 'timed_out'].includes(status);
  const warning = ['needs_attention', 'interrupted'].includes(status);
  /**
   * Selects variant in the existing condition order.
   */
  function selectVariant() {
    if (failed) {
      return 'destructive' as const;
    } else if (warning) {
      return 'warning' as const;
    } else {
      return 'secondary' as const;
    }
  }
  return (
    <Badge
      variant={selectVariant()}
      className={cn(
        status === 'succeeded' && 'bg-success/10 text-success',
        ['queued', 'claimed', 'dispatching', 'running'].includes(status) && 'bg-primary/10 text-primary'
      )}
    >
      {label}
    </Badge>
  );
}
