/**
 * @author Codex
 * @description Gives popup subpages a consistent back action, page title and trailing status or controls.
 */
import type { ReactNode } from 'react';
import { ArrowLeftIcon } from 'lucide-react';
import { Separator } from '@octopus/ui/components/separator';
import { Button } from '@octopus/ui/components/button';

/**
 * Renders page navigation without owning routes or feature state.
 */
export function NavigationBar({
  title,
  onBack,
  backLabel = '返回',
  trailing,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col" aria-label={`${title}导航`}>
      <div className="flex min-h-10 items-center gap-2 pb-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={backLabel} title={backLabel}>
            <ArrowLeftIcon />
          </Button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
      <Separator />
    </div>
  );
}
