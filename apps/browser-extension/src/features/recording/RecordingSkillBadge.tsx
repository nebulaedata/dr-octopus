/**
 * @author Codex
 * @description Shows recording organization progress independently of capture gaps and Skill persistence.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { cn } from '@octopus/ui/lib/utils';
import { Badge } from '@octopus/ui/components/badge';
import type { RecordingSkillState } from '../../lib/builtin-agent/skill-messages';

/**
 * An absent state means no current task or saved Skill after a successful projection read.
 */
export function RecordingSkillBadge({ state }: { state?: RecordingSkillState }) {
  let label = '待整理';
  if (state?.status === 'organizing') {
    label = '整理中';
  } else if (state?.status === 'organized') {
    label = '已整理';
  }
  if (state?.status === 'waiting_user') {
    label = '待回答';
  }
  if (state?.status === 'saving') {
    label = '待保存';
  }
  return (
    <Badge
      variant="secondary"
      className={cn(state?.status === 'organized' && 'border-success/20 bg-success/10 text-success')}
    >
      {state?.status === 'organizing' && (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      )}
      {label}
    </Badge>
  );
}
