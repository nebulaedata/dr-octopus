/**
 * @author Codex
 * @description Document management, import outcomes and paginated indexing state for one collection.
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileTextIcon, UploadIcon, ChevronDownIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@octopus/ui/components/button';
import { ListPagination } from '@/components/ListPagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@octopus/ui/components/dropdown-menu';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@octopus/ui/components/empty';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@octopus/ui/components/alert';
import { Spinner } from '@octopus/ui/components/spinner';
import { toast } from '@octopus/ui/components/toast';
import { getKnowledgeJob, listKnowledgeDocuments, uploadKnowledgeDocument } from '@/api/knowledge';
import { KnowledgeSearchAction } from './KnowledgeSearchAction';
import { KnowledgeDocumentTable } from './KnowledgeDocumentTable';
import { KnowledgeDocumentBatchActions } from './KnowledgeDocumentBatchActions';
import { KnowledgeJobFeedback } from './KnowledgeJobFeedback';
import { KnowledgeQueryErrorToast } from './KnowledgeQueryErrorToast';
import { KnowledgeTextDialog } from './KnowledgeTextDialog';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeCollection } from '@octopus/shared/protocol/knowledge';

/**
 * Keep upload and job state local to the selected collection; switching scope remounts this component.
 */
export function KnowledgeDocuments({
  workspaceId,
  collection,
}: {
  workspaceId?: string;
  collection: KnowledgeCollection;
}) {
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPending, setBatchPending] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const [textOpen, setTextOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const documents = useQuery({
    queryKey: ['knowledge', workspaceId ?? 'global', collection.id, 'documents', page],
    queryFn: ({ signal }) => listKnowledgeDocuments(workspaceId, collection.id, page, signal),
  });
  const job = useQuery({
    queryKey: ['knowledge', workspaceId ?? 'global', 'job', jobId],
    enabled: !!jobId,
    queryFn: ({ signal }) => getKnowledgeJob(workspaceId, jobId!, signal),
  });
  const upload = useMutation({
    mutationFn: ({ file, requestId }: { file: File; requestId: string }) =>
      uploadKnowledgeDocument(workspaceId, collection.id, file, requestId),
    onError: (error) => {
      toast.add({
        title: t('knowledge.documents.importFailed', 'Failed to import document'),
        description: error.message,
        type: 'error',
      });
    },
    onSuccess: (value) => {
      setJobId(value.id);
      void queryClient.invalidateQueries({ queryKey: ['knowledge', workspaceId ?? 'global', collection.id] });
    },
  });
  const items = documents.data?.items ?? [];
  const selected = items.filter((document) => selectedIds.includes(document.id));
  /**
   * Selects renderdiv content in the existing condition order.
   */
  function renderContent() {
    if (documents.isError && documents.data === undefined) {
      return (
        <div className="p-5">
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{t('knowledge.documents.loadFailed', 'Failed to load documents')}</AlertTitle>
            <AlertDescription>{documents.error.message}</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={() => void documents.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            </AlertAction>
          </Alert>
        </div>
      );
    } else if (!documents.isPending && !documents.data?.items.length) {
      return (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon />
            </EmptyMedia>
            <EmptyTitle>
              {t('knowledge.documents.emptyTitle', 'No documents in this collection yet')}
            </EmptyTitle>
            <EmptyDescription className="text-xs">
              {t(
                'knowledge.documents.emptyDescription',
                'Upload documents or add text to start building this knowledge.'
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    } else {
      return (
        <KnowledgeDocumentTable
          workspaceId={workspaceId}
          items={items}
          loading={documents.isPending}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          batchPending={batchPending}
          onJob={(job) => setJobId(job.id)}
        />
      );
    }
  }
  return (
    <div className="flex h-[70dvh] min-h-96 min-w-0 flex-col gap-5 lg:h-full lg:min-h-0">
      <section className="shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex flex-col min-w-0 gap-1">
            <h2 className="text-base font-semibold tracking-tight">{collection.name}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {collection.description ||
                t(
                  'knowledge.documents.descriptionFallback',
                  'Upload materials so the agent can find answers here.'
                )}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-3">
            <KnowledgeDocumentBatchActions
              workspaceId={workspaceId}
              collectionId={collection.id}
              documents={selected}
              onPendingChange={setBatchPending}
              onRemoved={(ids) => {
                setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
                if (ids.length === items.length && page > 1) {
                  setPage(page - 1);
                }
              }}
              onJob={(job) => setJobId(job.id)}
            />
            <KnowledgeSearchAction workspaceId={workspaceId} collection={collection} />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
                disabled={upload.isPending}
              >
                {upload.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {upload.isPending
                  ? t('knowledge.documents.uploading', 'Uploading…')
                  : t('knowledge.documents.add', 'Add')}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setTextOpen(true)}>
                    <PlusIcon />
                    {t('knowledge.documents.newText', 'New text')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => input.current?.click()}>
                    <UploadIcon />
                    {t('knowledge.documents.upload', 'Upload document')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={input}
              className="hidden"
              type="file"
              aria-label="Choose a knowledge document"
              accept=".docx,.xlsx,.pptx,.csv,.md,.txt,.pdf,.zip,.tar,.gz,.tgz"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  upload.mutate({ file, requestId: crypto.randomUUID() });
                }
                event.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
      {documents.data ? (
        <KnowledgeQueryErrorToast
          key={`documents:${page}`}
          title={t('knowledge.documents.loadFailed', 'Failed to load documents')}
          error={documents.error}
        />
      ) : null}
      {job.data ? (
        <KnowledgeQueryErrorToast
          key={`job:${jobId}`}
          title={t('knowledge.documents.jobLoadFailed', 'Failed to load job status')}
          error={job.error}
        />
      ) : null}
      {job.data ? <KnowledgeJobFeedback workspaceId={workspaceId} result={job.data} /> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card **:data-[slot=table-container]:overflow-visible">
        {renderContent()}
      </div>
      {(documents.data?.total ?? 0) > 20 || page > 1 ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {t('knowledge.documents.totalCount', '{{count}} documents in total', {
              count: documents.data?.total ?? 0,
            })}
          </span>
          <ListPagination
            aria-label="Document pagination"
            className="w-auto"
            page={page}
            pageCount={Math.max(1, Math.ceil((documents.data?.total ?? 0) / 20))}
            disabled={documents.isFetching || batchPending}
            onPageChange={(next) => {
              setSelectedIds([]);
              setPage(next);
            }}
          />
        </div>
      ) : null}
      {textOpen ? (
        <KnowledgeTextDialog
          onClose={() => setTextOpen(false)}
          onSave={async (file) => {
            await upload.mutateAsync({ file, requestId: crypto.randomUUID() });
            setTextOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
