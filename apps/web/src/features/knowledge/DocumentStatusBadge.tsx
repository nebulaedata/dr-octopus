/**
 * @author Codex
 * @description Renders knowledge document lifecycle states as compact tinted pills with a live pulse for active indexing.
 */
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import type { Translate } from '@/i18n/use-i18n';
import type { KnowledgeDocument } from '@octopus/shared/protocol/knowledge';

type DocumentStatus = KnowledgeDocument['status'];

interface StatusMeta {
  chip: string;
  dot: string;
  pulse?: boolean;
}

const STATUS_META: Record<DocumentStatus, StatusMeta> = {
  queued: {
    chip: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  indexing: {
    chip: 'bg-warning/60 text-warning-foreground',
    dot: 'bg-warning-foreground/80',
    pulse: true,
  },
  ready: {
    chip: 'bg-success/12 text-success',
    dot: 'bg-success',
  },
  failed: {
    chip: 'bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
  },
  deleted: {
    chip: 'bg-muted text-muted-foreground/70',
    dot: 'bg-muted-foreground/40',
  },
};

/**
 * Localizes the human-readable status while the token map above keeps the exact lifecycle union.
 */
function documentStatusLabel(t: Translate, status: DocumentStatus): string {
  switch (status) {
    case 'queued':
      return t('knowledge.documentStatus.queued', 'Queued');
    case 'indexing':
      return t('knowledge.documentStatus.indexing', 'Indexing');
    case 'ready':
      return t('knowledge.documentStatus.ready', 'Ready');
    case 'failed':
      return t('knowledge.documentStatus.failed', 'Failed');
    case 'deleted':
      return t('knowledge.documentStatus.deleted', 'Deleted');
  }
}

/**
 * Keeps status meaning readable at a glance while matching the calm, low-chroma surface palette.
 */
export function DocumentStatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const { t } = useI18n();
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
        meta.chip,
        className
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', meta.dot, meta.pulse && 'animate-pulse')} />
      {documentStatusLabel(t, status)}
    </span>
  );
}
