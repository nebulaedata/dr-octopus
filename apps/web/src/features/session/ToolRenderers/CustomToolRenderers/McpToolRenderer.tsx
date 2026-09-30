/**
 * @author Codex
 * @description Presents MCP proxy arguments, previewable images and complete textual results in reading order.
 */
import { useI18n } from '@/i18n/use-i18n';
import { BracesIcon } from 'lucide-react';
import { ImageAttachment } from '@/features/session/ImageAttachment';
import { formatToolValue } from '@/features/session/utils/tool-renderer-utils';
import { ToolCodeBlock, ToolContent, ToolOutputSection, ToolSection } from '../ToolRendererParts';
import type { ToolRendererProps } from '../ToolRendererParts';

/**
 * Keeps arguments independent, output visible and optional diagnostics collapsed below the output.
 */
export function McpToolRenderer({ tool }: ToolRendererProps) {
  const { t } = useI18n();
  const images = tool.content.filter((block) => block.type === 'image');
  const text = tool.content.filter((block) => block.type === 'text');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {tool.arguments !== undefined && (
        <ToolSection title={t('session.toolParts.arguments', 'Arguments')} icon={BracesIcon}>
          <ToolCodeBlock language="json" maxHeight={192} streaming={tool.status === 'running'}>
            {formatToolValue(tool.arguments)}
          </ToolCodeBlock>
        </ToolSection>
      )}
      <ToolOutputSection details={tool.details} streaming={tool.status === 'running'}>
        {images.length > 0 && (
          <div className="flex min-w-0 flex-col gap-3">
            {images.map((block, index) => (
              <ImageAttachment
                key={index}
                block={block}
                preview
                title={t('session.mcpTool.imageTitle', 'MCP image {{number}}', { number: index + 1 })}
              />
            ))}
          </div>
        )}
        {(text.length > 0 || (images.length === 0 && tool.details === undefined)) && (
          <ToolContent blocks={text} />
        )}
      </ToolOutputSection>
    </div>
  );
}
