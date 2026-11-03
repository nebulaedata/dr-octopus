/**
 * @author Codex
 * @description Unifies the clickable recording row geometry and feedback across the home panel and the full list.
 */
import type { ReactNode } from 'react';
import { PopupListItem } from '../../components/PopupListItem';
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react';
import { RecordingSkillBadge } from './RecordingSkillBadge';
import type { RecordingSkillState } from '../../lib/builtin-agent/skill-messages';

/**
 * Renders one full-width record row; independent Separator siblings belong to the owning list, outside the rounded button.
 */
export function RecordingRow({
  name,
  meta,
  skillState,
  gapCount = 0,
  onOpen,
  className = '',
}: {
  name: string;
  meta: ReactNode;
  skillState?: RecordingSkillState;
  gapCount?: number;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <PopupListItem className={className} onClick={onOpen}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {meta}
          {gapCount > 0 && (
            <span className="inline-flex items-center gap-1" title="部分操作可能未记录，详情中可查看缺口。">
              <TriangleAlertIcon className="size-3" aria-hidden="true" />
              存在缺口
            </span>
          )}
        </span>
      </span>
      <RecordingSkillBadge state={skillState} />
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
        aria-hidden="true"
      />
    </PopupListItem>
  );
}
