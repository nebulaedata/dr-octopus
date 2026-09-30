/**
 * @author Codex
 * @description Renders Pi built-in coding tools with concise, task-specific presentation.
 */

import { readString, isRecord } from '@/features/session/utils/tool-renderer-utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { ChevronRightIcon } from 'lucide-react';
import { ToolCodeBlock, ToolContent, ToolSection } from './ToolRendererParts';
import { getHighlightLanguage } from '@/components/Highlight/languages';
import { useI18n } from '@/i18n/use-i18n';
import type { ToolRendererProps } from '@/features/session/ToolRenderers/ToolRendererParts';

/**
 * Shows a shell command and streams its output using terminal visual semantics.
 */
export function BashToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const command = readString(tool.arguments, 'command');
  return (
    <div className="flex flex-col gap-3">
      {command === undefined ? null : (
        <ToolSection title={t('session.builtinTool.command', 'Command')}>
          <ToolCodeBlock language="bash" maxHeight={192} streaming={tool.status === 'running'}>
            {command}
          </ToolCodeBlock>
        </ToolSection>
      )}
      <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
        <ToolContent blocks={tool.content} />
      </ToolSection>
      <TruncationNotice details={tool.details} />
    </div>
  );
}

/**
 * Shows file content or an image while retaining truncation diagnostics.
 */
export function ReadToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const path = readString(tool.arguments, 'path');
  return (
    <div className="flex flex-col gap-3">
      <ToolSection title={t('session.builtinTool.content', 'Content')}>
        <ToolContent
          blocks={tool.content}
          language={getHighlightLanguage(path)}
          streaming={tool.status === 'running'}
        />
      </ToolSection>
      <TruncationNotice details={tool.details} />
    </div>
  );
}

/**
 * Prioritizes Pi's display-oriented diff over its model-facing text result.
 */
export function EditToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const diff = readString(tool.details, 'diff');
  return (
    <ToolSection
      title={
        diff === undefined
          ? t('session.schedulerTool.statusTitle.output', 'Output')
          : t('session.builtinTool.changes', 'Changes')
      }
    >
      {diff === undefined ? (
        <ToolContent blocks={tool.content} />
      ) : (
        <ToolCodeBlock maxHeight={512} language="diff" streaming={tool.status === 'running'}>
          {diff}
        </ToolCodeBlock>
      )}
    </ToolSection>
  );
}

/**
 * Offers the input file body on demand while keeping the actual write result visible.
 */
export function WriteToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const content = isRecord(tool.arguments) ? tool.arguments['content'] : undefined;
  const path = readString(tool.arguments, 'path');
  return (
    <div className="flex flex-col gap-3">
      {typeof content !== 'string' ? null : (
        <Collapsible defaultOpen={false} className="min-w-0">
          <CollapsibleTrigger className="group/write-content flex min-h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 motion-safe:transition-transform group-data-panel-open/write-content:rotate-90"
            />
            {t('session.builtinTool.writeContent', 'Write content')}
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted={false} className="pt-2">
            <ToolCodeBlock
              language={getHighlightLanguage(path)}
              maxHeight={384}
              streaming={tool.status === 'running'}
            >
              {content}
            </ToolCodeBlock>
          </CollapsibleContent>
        </Collapsible>
      )}
      {tool.content.length === 0 ? null : (
        <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
          <ToolContent blocks={tool.content} />
        </ToolSection>
      )}
    </div>
  );
}

/**
 * Renders line-oriented search and directory results with their limit metadata.
 */
export function SearchToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <ToolSection title={t('session.builtinTool.results', 'Results')}>
        <ToolContent blocks={tool.content} />
      </ToolSection>
      <TruncationNotice details={tool.details} />
    </div>
  );
}

/**
 * Displays a compact warning when Pi reports truncated or limited output.
 */
export function TruncationNotice({ details }: { details: unknown }) {
  const { t } = useI18n();
  if (!isRecord(details)) {
    return null;
  }
  const truncation = isRecord(details['truncation']) ? details['truncation'] : undefined;
  const limit = details['matchLimitReached'] ?? details['resultLimitReached'] ?? details['entryLimitReached'];
  if (truncation?.['truncated'] !== true && typeof limit !== 'number') {
    return null;
  }
  const totalLines = truncation?.['totalLines'];
  const outputLines = truncation?.['outputLines'];
  const lineSummary =
    typeof totalLines === 'number' && typeof outputLines === 'number'
      ? t('session.builtinTool.truncationLines', 'Showing {{outputLines}} of {{totalLines}} lines.', {
          outputLines: outputLines.toLocaleString(),
          totalLines: totalLines.toLocaleString(),
        })
      : undefined;
  const limitSummary =
    typeof limit === 'number'
      ? t('session.builtinTool.truncationLimited', 'Limited to {{count}} results.', {
          count: limit,
        })
      : undefined;
  return (
    <p className="text-xs text-muted-foreground">
      {lineSummary ?? limitSummary ?? t('session.builtinTool.truncationGeneric', 'Output limited.')}
    </p>
  );
}
