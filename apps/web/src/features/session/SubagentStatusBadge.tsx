/**
 * @author Codex
 * @description Shares semantic execution colors between Fleet nodes and subagent tool results.
 */

import { Badge } from '@octopus/ui/components/badge';
import { cn } from '@octopus/ui/lib/utils';
import type { ReactNode } from 'react';
import type { SubagentFleetNodeState } from '@octopus/shared/protocol';

/**
 * Keeps status text and icons while distinguishing active, successful, failed and paused work.
 */
export function SubagentStatusBadge({
  state,
  children,
}: {
  state: SubagentFleetNodeState | 'completed' | 'pending' | 'detached';
  children: ReactNode;
}) {
  const failed = state === 'failed' || state === 'rejected';
  const warning = state === 'paused' || state === 'partial';
  const active = state === 'running' || state === 'queued' || state === 'pending';
  const complete = state === 'complete' || state === 'completed';
  return (
    <Badge
      variant={failed ? 'destructive' : warning ? 'warning' : 'secondary'}
      className={cn(active && 'bg-primary/10 text-primary', complete && 'bg-success/10 text-success')}
    >
      {children}
    </Badge>
  );
}
