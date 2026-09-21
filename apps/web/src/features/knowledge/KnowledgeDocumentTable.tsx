/**
 * @author Codex
 * @description Renders paginated knowledge documents with accessible row and current-page selection.
 */
import { Badge } from '@octopus/ui/components/badge';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { ScrollArea, ScrollBar } from '@octopus/ui/components/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@octopus/ui/components/table';
import { Checkbox } from '@octopus/ui/components/checkbox';
import { CheckboxHalf } from '@/components/CheckboxHalf';
import { KnowledgeDocumentActions } from './KnowledgeDocumentActions';
import { DocumentTypeIcon } from './DocumentTypeIcon';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import { useI18n } from '@/i18n/use-i18n';
import type { Dispatch, SetStateAction } from 'react';
import type { KnowledgeDocument, KnowledgeJob } from '@octopus/shared/protocol/knowledge';

/**
 * Keeps checkbox state controlled by the collection view so batch actions share the same selection.
 */
export function KnowledgeDocumentTable({
  workspaceId,
  items,
  loading,
  selectedIds,
  setSelectedIds,
  batchPending,
  onJob,
}: {
  workspaceId?: string;
  items: KnowledgeDocument[];
  loading: boolean;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  batchPending: boolean;
  /**
   * Reports a row replacement job to the collection's task observer.
   */
  onJob(job: KnowledgeJob): void;
}) {
  const { t } = useI18n();
  const selected = items.filter((document) => selectedIds.includes(document.id));
  return (
    <ScrollArea
      role="region"
      aria-label="Knowledge document list"
      className="min-h-0 flex-1"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 pl-4">
              <CheckboxHalf
                aria-label="Select all documents on this page"
                checked={items.length > 0 && selected.length === items.length}
                indeterminate={selected.length > 0 && selected.length < items.length}
                disabled={!items.length || batchPending}
                onCheckedChange={(checked) => setSelectedIds(checked ? items.map((item) => item.id) : [])}
              />
            </TableHead>
            <TableHead className="pl-4 text-sm font-semibold text-muted-foreground">
              {t('knowledge.table.columnDocument', 'Document')}
            </TableHead>
            <TableHead className="text-sm font-semibold text-muted-foreground">
              {t('knowledge.table.columnStatus', 'Status')}
            </TableHead>
            <TableHead className="text-sm font-semibold text-muted-foreground">
              {t('knowledge.table.columnFormat', 'Format')}
            </TableHead>
            <TableHead className="pr-4 text-right text-sm font-semibold text-muted-foreground">
              {t('knowledge.table.columnActions', 'Actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? [0, 1, 2, 3, 4].map((row) => (
                <TableRow key={row} className="hover:bg-transparent">
                  <TableCell className="pl-4">
                    <Skeleton className="size-4" />
                  </TableCell>
                  <TableCell className="py-2.5 pl-4">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-lg" />
                      <div>
                        <Skeleton className="h-4 w-48 max-w-full" />
                        <Skeleton className="mt-1.5 h-3 w-20" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end">
                      <Skeleton className="size-7 rounded-md" />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            : items.map((document) => (
                <TableRow
                  key={document.id}
                  data-state={selectedIds.includes(document.id) ? 'selected' : undefined}
                >
                  <TableCell className="pl-4">
                    <Checkbox
                      aria-label={`Select document ${document.title}`}
                      checked={selectedIds.includes(document.id)}
                      disabled={batchPending}
                      onCheckedChange={(checked) =>
                        setSelectedIds((current) =>
                          checked ? [...current, document.id] : current.filter((id) => id !== document.id)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="py-2.5 pl-4">
                    <div className="flex items-center gap-3">
                      <DocumentTypeIcon format={document.format} />
                      <div className="min-w-0">
                        <div className="max-w-80 truncate text-sm font-medium">{document.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums font-geist">
                          {new Date(document.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DocumentStatusBadge status={document.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="px-1.5 text-muted-foreground uppercase font-geist">
                      {document.format}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <KnowledgeDocumentActions workspaceId={workspaceId} document={document} onJob={onJob} />
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
