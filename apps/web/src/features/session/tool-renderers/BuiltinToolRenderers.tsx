/**
 * @author Codex
 * @description Renders Pi built-in coding tools with concise, task-specific presentation.
 */

import { readString, isRecord } from './tool-renderer-utils';
import { ToolContent, ToolSection } from './ToolRendererParts';
import { Highlight } from '@/components/Highlight/index';
import { getHighlightLanguage } from '@/components/Highlight/languages';
import { useI18n } from '@/i18n/use-i18n';
import type { ToolRendererProps } from './types';

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
          <Highlight language="bash">{command}</Highlight>
        </ToolSection>
      )}
      <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
        <ToolContent blocks={tool.content} terminal />
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
        <ToolContent blocks={tool.content} language={getHighlightLanguage(path)} />
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
        <Highlight className="max-h-128" language="diff">
          {diff}
        </Highlight>
      )}
    </ToolSection>
  );
}

/**
 * Summarizes a write without repeating the potentially large file body argument.
 */
export function WriteToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const content = readString(tool.arguments, 'content');
  return (
    <div className="flex flex-col gap-3">
      {content === undefined ? null : (
        <p className="text-sm text-muted-foreground">
          {t('session.builtinTool.wroteCharacters', 'Wrote {{count}} characters.', {
            count: content.length,
          })}
        </p>
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
function TruncationNotice({ details }: { details: unknown }) {
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
