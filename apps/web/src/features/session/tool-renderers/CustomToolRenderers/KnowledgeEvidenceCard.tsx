/**
 * @author Codex
 * @description Composes a source excerpt and accessible reading dialog from an immutable knowledge evidence snapshot.
 */
import { ArrowUpRightIcon, FileTextIcon, QuoteIcon, ScanTextIcon } from 'lucide-react';
import { Badge } from '@octopus/ui/components/badge';
import { Button } from '@octopus/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@octopus/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@octopus/ui/components/dialog';
import { Separator } from '@octopus/ui/components/separator';
import { useI18n } from '@/i18n/use-i18n';
import type { KnowledgeEvidence } from './knowledge-projection';

/**
 * Present retrieval rank as an ordinal, never as an invented confidence score or document count.
 */
export function KnowledgeEvidenceCard({
  evidence,
  index,
  expanded = false,
}: {
  evidence: KnowledgeEvidence;
  index?: number;
  expanded?: boolean;
}) {
  const { t } = useI18n();
  const evidenceLabel =
    index === undefined
      ? t('session.knowledgeEvidence.quoteOriginal', 'Original quote')
      : t('session.knowledgeEvidence.evidenceNumber', 'Evidence {{number}}', {
          number: String(index + 1).padStart(2, '0'),
        });
  return (
    <Card size="sm" className="min-w-0 [--card-spacing:--spacing(4)]">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-medium text-primary">
            <QuoteIcon className="size-3.5" aria-hidden="true" />
            {evidenceLabel}
          </span>
          {evidence.ocr ? (
            <Badge variant="outline">
              <ScanTextIcon data-icon="inline-start" />
              {t('session.knowledgeEvidence.ocrBadge', 'OCR recognized')}
            </Badge>
          ) : (
            <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <CardTitle className="line-clamp-2 wrap-anywhere" title={evidence.title}>
          {evidence.title}
        </CardTitle>
        <CardDescription className="line-clamp-2 wrap-anywhere">{evidence.locator}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {expanded ? (
          <KnowledgeEvidenceText evidence={evidence} />
        ) : (
          <p className="line-clamp-4 whitespace-pre-wrap wrap-anywhere border-l-2 border-primary/25 pl-3 text-sm leading-6 text-muted-foreground">
            {evidence.text.slice(0, 1200) ||
              t('session.knowledgeEvidence.emptyText', 'This quote has no displayable text.')}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('session.knowledgeEvidence.fragment', 'Material fragment')}
        </span>
        <Dialog>
          <DialogTrigger
            render={<Button variant="ghost" size="sm" />}
            aria-label={`View quote: ${evidence.title}`}
          >
            {t('session.knowledgeEvidence.readQuote', 'Read quote')}
            <ArrowUpRightIcon data-icon="inline-end" />
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
            <DialogHeader className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                <FileTextIcon className="size-4" aria-hidden="true" />
                {t('session.knowledgeEvidence.readingPrefix', 'Reading · ')}
                {evidenceLabel}
              </div>
              <DialogTitle className="wrap-anywhere pr-5">{evidence.title}</DialogTitle>
              <DialogDescription className="wrap-anywhere">
                {evidence.locator}
                {' · '}
                {t(
                  'session.knowledgeEvidence.snapshotNote',
                  'Material snapshot returned by this tool call'
                )}
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <KnowledgeEvidenceText evidence={evidence} />
            <Separator />
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-xs font-medium">
                {t('session.knowledgeEvidence.citationLabel', 'Citation ID')}
              </span>
              <p className="select-all break-all font-mono text-xs leading-5 text-muted-foreground">
                {evidence.citationId ??
                  t('session.knowledgeEvidence.citationMissing', 'This result did not provide a citation ID')}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {t(
                  'session.knowledgeEvidence.snapshotRetention',
                  'Content preserved from retrieval time; the source material may have been updated since.'
                )}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}

/**
 * Render source content as plain text, preserving wrapping without running document markup.
 */
function KnowledgeEvidenceText({ evidence }: { evidence: KnowledgeEvidence }) {
  const { t } = useI18n();
  return (
    <div
      className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg bg-muted/40 p-4 sm:p-5"
      tabIndex={0}
      role="region"
      aria-label="Quote body"
    >
      <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-7">
        {evidence.text || t('session.knowledgeEvidence.emptyText', 'This quote has no displayable text.')}
      </p>
      {evidence.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            'session.knowledgeEvidence.truncatedNote',
            'Fragment too long; showing the first 24,000 characters.'
          )}
        </p>
      )}
    </div>
  );
}
