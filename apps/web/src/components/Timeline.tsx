/**
 * @author Codex
 * @description Provides a domain-independent vertical timeline with accessible optional disclosures.
 */
import { ChevronDownIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@octopus/ui/components/collapsible';
import {
  Timeline as TimelineLayout,
  TimelineItem as TimelineNode,
} from '@octopus/custom-ui/components/timeline';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Preserve caller ordering and expose the sequence as a semantic list.
 */
export function Timeline({ className, ...props }: ComponentProps<'ol'>) {
  return <TimelineLayout className={className} {...props} />;
}

/**
 * Render a connected event; collapsible details start closed unless explicitly requested.
 */
export function TimelineItem({
  icon,
  title,
  children,
  collapsible = false,
  defaultOpen = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <TimelineNode icon={icon}>
      {collapsible ? (
        <Collapsible defaultOpen={defaultOpen} className="min-w-0">
          <CollapsibleTrigger className="group/trigger flex min-h-7 w-full items-center gap-2 rounded-md text-left text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0 break-words">{title}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="min-w-0 pt-3">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="min-w-0">
          <h3 className="flex min-h-7 items-center text-sm font-medium">{title}</h3>
          <div className="min-w-0 pt-3">{children}</div>
        </div>
      )}
    </TimelineNode>
  );
}
