/**
 * @author Codex
 * @description Composes Executor status colors and optional accessible explanations without changing shared Badge primitives.
 */
import { useId, type ComponentProps } from 'react';
import { Badge } from '@octopus/ui/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@octopus/ui/components/tooltip';
import { cn } from '@octopus/ui/lib/utils';

type ConnectionBadgeProps = Omit<ComponentProps<typeof Badge>, 'variant' | 'render'> & {
  variant?: ComponentProps<typeof Badge>['variant'] | 'success';
  description?: string;
};

/**
 * Keeps labels compact and makes supplementary descriptions available on hover and keyboard focus.
 */
export function ConnectionBadge({
  variant = 'secondary',
  description,
  className,
  ...props
}: ConnectionBadgeProps) {
  const descriptionId = useId();
  const badge = (
    <Badge
      {...props}
      variant={variant === 'success' ? 'secondary' : variant}
      className={cn(
        variant === 'success' && 'executor-status-success',
        description && 'cursor-help',
        className
      )}
      render={description ? <button type="button" /> : undefined}
    />
  );
  if (!description) {
    return badge;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={badge} aria-describedby={descriptionId} />
      <TooltipContent id={descriptionId} role="tooltip">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
