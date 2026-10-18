/**
 * @author Codex
 * @description 封装 ReactMarkdown，提供统一的插件、安全策略与 Mermaid 代码块渲染
 */

import { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { cn } from '@octopus/ui/lib/utils';
import { useI18n } from '@/i18n/use-i18n';
import { ImagePreviewDialog } from '@/components/ImagePreviewDialog';
import type { ComponentProps } from 'react';

/**
 * 动态加载 Mermaid，并在严格安全模式下渲染代码块。
 */
function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const { t } = useI18n();
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        const result = await mermaid.render(`mermaid-${reactId.replaceAll(':', '')}`, source);
        if (active) {
          setSvg(DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } }));
        }
      })
      .catch(
        (reason: unknown) =>
          active &&
          setError(
            reason instanceof Error
              ? reason.message
              : t('components.markdownRenderer.mermaidFailed', 'Mermaid rendering failed.')
          )
      );
    return () => {
      active = false;
    };
  }, [reactId, source, t]);
  if (error !== undefined) {
    return <pre>{`${source}\n\n${error}`}</pre>;
  }
  if (svg === undefined) {
    return <Skeleton className="h-28 rounded-lg" aria-label="Rendering diagram" />;
  }
  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * 为 Markdown 代码块提供 Mermaid 专用渲染器。
 */
function MarkdownCode({ className, children, ...props }: ComponentProps<'code'>) {
  if (className === 'language-mermaid') {
    return <MermaidDiagram source={String(children).replace(/\n$/, '')} />;
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

/**
 * Opens Markdown images in the shared viewer while retaining inline image layout and link semantics.
 */
function MarkdownImage({ src, alt, className, title: imageTitle, width, height }: ComponentProps<'img'>) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const title = alt || t('components.imageThumbnails.previewTitle', 'Image preview');
  const source = typeof src === 'string' ? src : undefined;
  return (
    <>
      <img
        src={src}
        alt={alt ?? ''}
        title={imageTitle}
        width={width}
        height={height}
        loading="lazy"
        role={source ? 'button' : undefined}
        tabIndex={source ? 0 : undefined}
        aria-label={source ? `Preview ${title}` : undefined}
        className={cn(
          className,
          source && 'cursor-zoom-in rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
        onClick={(event) => {
          if (source) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (source && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      />
      {source && <ImagePreviewDialog open={open} onOpenChange={setOpen} src={source} title={title} />}
    </>
  );
}

/**
 * 使用统一的 remark/rehype 插件与安全策略渲染 Markdown 内容。
 */
export function MarkdownRenderer({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ReactMarkdown>, 'children' | 'className'> & {
  children: string;
  className?: string;
}) {
  return (
    <div data-scope="github-markdown" className={cn('markdown-body', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{ code: MarkdownCode, img: MarkdownImage }}
        {...props}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
