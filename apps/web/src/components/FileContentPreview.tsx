/**
 * @author root
 * @description Provides the shared safe rendering surface used by Workspace files and attachment previews.
 */

import { cn } from '@octopus/ui/lib/utils';
import { HtmlRenderer } from './HtmlRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

export type FileContentPreviewKind = 'html' | 'markdown';

export interface FileContentPreviewProps {
  children: string;
  className?: string;
  kind: FileContentPreviewKind;
}

/**
 * Renders an explicitly selected safe preview kind without inspecting a path or filename.
 */
export function FileContentPreview({ children, className, kind }: FileContentPreviewProps) {
  if (kind === 'html') {
    return (
      <div className={cn('h-full min-h-0 overflow-hidden', className)}>
        <HtmlRenderer>{children}</HtmlRenderer>
      </div>
    );
  }
  return (
    <div className={cn('h-full min-h-0 overflow-auto p-6', className)}>
      <MarkdownRenderer>{children}</MarkdownRenderer>
    </div>
  );
}
