/**
 * @author Codex
 * @description 安全渲染 Markdown 与思考块文本内容
 */

import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ThoughtDisclosureMarker } from './ThoughtDisclosureMarker';
import type { MessageProjection } from '@/stores/session';

/**
 * 渲染一组已归一化文本/思考内容块。
 */
export function RichContent({ isStreaming, message }: { isStreaming: boolean; message: MessageProjection }) {
  const thinkingText = message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.text)
    .join('\n\n');
  const textBlocks = message.content.filter((block) => block.type === 'text');
  const hasResponseText = textBlocks.some((block) => block.text.length > 0);
  const isThinking = isStreaming && !hasResponseText;
  const showThought = isThinking || thinkingText.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {showThought ? (
        <ThoughtDisclosureMarker
          endedAt={message.thinkingEndedAt}
          isThinking={isThinking}
          startedAt={message.thinkingStartedAt}
          text={thinkingText}
        />
      ) : null}
      {textBlocks.map((block, index) => (
        <MarkdownRenderer key={`text-${String(index)}`}>{block.text}</MarkdownRenderer>
      ))}
    </div>
  );
}
