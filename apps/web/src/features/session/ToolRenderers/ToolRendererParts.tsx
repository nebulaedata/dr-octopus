/**
 * @author Codex
 * @description Provides reusable visual sections and the safe fallback tool renderer.
 */

import { Separator } from '@octopus/ui/components/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import { BracesIcon, ChevronRightIcon, TerminalIcon } from 'lucide-react';
import { cn } from '@octopus/ui/lib/utils';
import { Highlight } from '@/components/Highlight/index';
import { CodeBlock } from '@octopus/custom-ui/components/code-block';
import { ImageAttachment } from '../ImageAttachment';
import { useI18n } from '@/i18n/use-i18n';
import { formatToolValue } from '@/features/session/utils/tool-renderer-utils';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ToolContentBlock, ToolProjection } from '@/stores/session';
import type { HighlightLanguage } from '@/components/Highlight/index';

/**
 * Renders a labelled region inside a tool result.
 */
export function ToolSection({
  children,
  title,
  icon: Icon,
}: {
  children: ReactNode;
  title: string;
  icon?: LucideIcon;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h4
        className={cn(
          'text-xs font-medium text-muted-foreground',
          Icon && 'flex min-h-8 items-center gap-1.5 px-1'
        )}
      >
        {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * Displays raw output immediately, with optional diagnostics in a closed disclosure below it.
 * Mounted diagnostics retain scroll state while the enclosing tool row is open.
 */
export function ToolOutputSection({
  children,
  details,
  streaming = false,
}: {
  children?: ReactNode;
  details?: unknown;
  streaming?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ToolSection title={t('session.schedulerTool.statusTitle.output', 'Output')} icon={TerminalIcon}>
      <div className="flex min-w-0 flex-col gap-3">
        {children}
        {details === undefined ? null : (
          <Collapsible defaultOpen={false} className="min-w-0">
            <CollapsibleTrigger className="group/tool-details flex min-h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 shrink-0 motion-safe:transition-transform group-data-panel-open/tool-details:rotate-90"
              />
              {t('session.toolParts.details', 'Details')}
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted className="pt-2">
              <ToolCodeBlock language="json" maxHeight={288} streaming={streaming}>
                {formatToolValue(details)}
              </ToolCodeBlock>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </ToolSection>
  );
}

/**
 * Composes the shared scroll surface and highlighter with tool-specific language and streaming policy.
 */
export function ToolCodeBlock({
  children,
  language = 'plaintext',
  streaming = false,
  maxHeight = 384,
  className,
}: {
  children: string;
  language?: HighlightLanguage;
  streaming?: boolean;
  maxHeight?: number;
  className?: string;
}) {
  return (
    <CodeBlock maxHeight={maxHeight} className={className} aria-label="Tool text">
      <Highlight language={language} highlight={!streaming} className="overflow-visible rounded-none">
        {children}
      </Highlight>
    </CodeBlock>
  );
}

/**
 * Renders text and image blocks without assuming tool-specific semantics.
 */
export function ToolContent({
  blocks,
  language,
  streaming = false,
}: {
  blocks: ToolContentBlock[];
  language?: HighlightLanguage;
  streaming?: boolean;
}) {
  const { t } = useI18n();
  if (blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('session.toolParts.noOutput', 'No output returned.')}
      </p>
    );
  }
  return blocks.map((block, index) => {
    if (block.type === 'image') {
      return (
        <ImageAttachment
          key={`image-${String(index)}`}
          block={block}
          title={t('session.toolParts.toolOutputAlt', 'Tool output')}
        />
      );
    } else {
      return (
        <ToolCodeBlock key={`text-${String(index)}`} language={language} streaming={streaming}>
          {block.text}
        </ToolCodeBlock>
      );
    }
  });
}

/**
 * Renders the complete raw contract for an unrecognized tool.
 */
export function FallbackToolRenderer({ tool }: { tool: ToolProjection }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {tool.arguments === undefined ? null : (
        <ToolSection title={t('session.toolParts.arguments', 'Arguments')} icon={BracesIcon}>
          <ToolCodeBlock language="json" maxHeight={192} streaming={tool.status === 'running'}>
            {formatToolValue(tool.arguments)}
          </ToolCodeBlock>
        </ToolSection>
      )}
      {tool.arguments === undefined || (tool.content.length === 0 && tool.details === undefined) ? null : (
        <Separator />
      )}
      <ToolOutputSection details={tool.details} streaming={tool.status === 'running'}>
        {tool.content.length > 0 || tool.details === undefined ? (
          <ToolContent
            blocks={[
              ...tool.content.filter((block) => block.type === 'image'),
              ...tool.content.filter((block) => block.type === 'text'),
            ]}
          />
        ) : null}
      </ToolOutputSection>
    </div>
  );
}

export interface ToolRendererProps {
  tool: ToolProjection;
}
