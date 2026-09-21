import { Message, MessageContent, MessageFooter, MessageHeader } from '@octopus/ui/components/message';
import { Bubble, BubbleContent } from '@octopus/ui/components/bubble';
import { Skeleton } from '@octopus/ui/components/skeleton';
import { MessageScrollerItem } from '@octopus/ui/components/message-scroller';

export interface MessageSkeletonProps {
  /**
   * 对话框占位行的渲染轮数。默认值为 4。
   * 这允许在对话框中显示更多的占位行，以模拟更长的消息历史记录。
   *
   * @default 4
   * @type {number}
   * @memberof MessageSkeletonProps
   */
  rows?: number;
}

/**
 * Presents placeholder chat rows while the first Session snapshot is being hydrated.
 */
export function MessageSkeleton({ rows = 4 }: MessageSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, index) => (
        <MessageScrollerItem key={index}>
          <SkeletonRow align={index % 2 === 0 ? 'start' : 'end'} />
        </MessageScrollerItem>
      ))}
    </>
  );
}

/**
 * Renders one placeholder message row aligned like an agent or user bubble.
 */
export function SkeletonRow({ align }: { align: 'start' | 'end' }) {
  return (
    <Message align={align}>
      <MessageContent>
        <MessageHeader>
          <Skeleton className="h-3.5 w-10 bg-accent" />
        </MessageHeader>
        <Bubble variant="ghost" align={align}>
          <BubbleContent>
            <Skeleton className="h-12 w-56" />
          </BubbleContent>
        </Bubble>
        <MessageFooter>
          <Skeleton className="h-4 w-28" />
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}
