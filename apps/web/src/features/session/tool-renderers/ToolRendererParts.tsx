/**
 * @author Codex
 * @description Provides reusable visual sections and the safe fallback tool renderer.
 */

import { Separator } from '@octopus/ui/components/separator';
import { Highlight } from '@/components/Highlight/index';
import { ImageAttachment } from '../ImageAttachment';
import { useI18n } from '@/i18n/use-i18n';
import { formatToolValue } from './tool-renderer-utils';
import type { ReactNode } from 'react';
import type { ToolContentBlock, ToolProjection } from '@/stores/session';
import type { HighlightLanguage } from '@/components/Highlight/index';

/**
 * Renders a labelled region inside a tool result.
 */
export function ToolSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/**
 * Renders text and image blocks without assuming tool-specific semantics.
 */
export function ToolContent({
  blocks,
  language,
  terminal = false,
}: {
  blocks: ToolContentBlock[];
  language?: HighlightLanguage;
  terminal?: boolean;
}) {
  const { t } = useI18n();
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('session.toolParts.noOutput', 'No output returned.')}</p>;
  }
  return blocks.map((block, index) =>
    block.type === 'image' ? (
      <ImageAttachment
        key={`image-${String(index)}`}
        block={block}
        title={t('session.toolParts.toolOutputAlt', 'Tool output')}
      />
    ) : language === undefined ? (
      <pre
        key={`text-${String(index)}`}
        className={
          terminal
            ? 'max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground'
            : 'max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap'
        }
      >
        {block.text}
      </pre>
    ) : (
      <Highlight key={`text-${String(index)}`} className="max-h-96" language={language}>
        {block.text}
      </Highlight>
    )
  );
}

/**
 * Renders the complete raw contract for an unrecognized tool.
 */
export function FallbackToolRenderer({ tool }: { tool: ToolProjection }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {tool.arguments === undefined ? null : (
        <ToolSection title={t('session.toolParts.arguments', 'Arguments')}>
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
            {formatToolValue(tool.arguments)}
          </pre>
        </ToolSection>
      )}
      {tool.arguments === undefined || (tool.content.length === 0 && tool.details === undefined) ? null : (
        <Separator />
      )}
      {tool.content.length === 0 ? null : (
        <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')}>
          <ToolContent blocks={tool.content} />
        </ToolSection>
      )}
      {tool.details === undefined ? null : (
        <>
          {tool.content.length === 0 ? null : <Separator />}
          <ToolSection title={t('session.toolParts.details', 'Details')}>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
              {formatToolValue(tool.details)}
            </pre>
          </ToolSection>
        </>
      )}
    </div>
  );
}
