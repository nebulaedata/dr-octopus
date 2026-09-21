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
  return (
    <Badge
      variant={failed ? 'destructive' : warning ? 'warning' : 'secondary'}
      className={cn(
        status === 'succeeded' && 'bg-success/10 text-success',
        ['queued', 'claimed', 'dispatching', 'running'].includes(status) && 'bg-primary/10 text-primary'
      )}
    >
      {label}
    </Badge>
  );
}
