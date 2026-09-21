/**
 * @author Codex
 * @description Maps knowledge document formats to recognizable icon tiles with restrained, type-specific tints.
 */
import {
  FileArchiveIcon,
  FileCodeIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  PresentationIcon,
  TableIcon,
} from 'lucide-react';
import { cn } from '@octopus/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface FormatMeta {
  icon: LucideIcon;
  tile: string;
}

const ARCHIVE_TILE = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';

const FORMAT_META: Record<string, FormatMeta> = {
  pdf: { icon: FileTextIcon, tile: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  docx: { icon: FileTextIcon, tile: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  xlsx: { icon: FileSpreadsheetIcon, tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  pptx: { icon: PresentationIcon, tile: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  csv: { icon: TableIcon, tile: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  md: { icon: FileCodeIcon, tile: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  txt: { icon: FileTypeIcon, tile: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
  zip: { icon: FileArchiveIcon, tile: ARCHIVE_TILE },
  tar: { icon: FileArchiveIcon, tile: ARCHIVE_TILE },
  gz: { icon: FileArchiveIcon, tile: ARCHIVE_TILE },
  tgz: { icon: FileArchiveIcon, tile: ARCHIVE_TILE },
};

const DEFAULT_META: FormatMeta = { icon: FileTextIcon, tile: 'bg-muted text-muted-foreground' };

/**
 * Renders one consistent tile so format families stay scannable inside dense document tables.
 */
export function DocumentTypeIcon({
  format,
  className,
  iconClassName,
}: {
  format: string;
  className?: string;
  iconClassName?: string;
}) {
  const meta = FORMAT_META[format.toLowerCase()] ?? DEFAULT_META;
  const Icon = meta.icon;
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', meta.tile, className)}>
      <Icon className={cn('size-4', iconClassName)} />
    </span>
  );
}
