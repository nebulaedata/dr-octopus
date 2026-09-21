/**
 * @author Codex
 * @description Presents normalized runtime state with one reusable visual indicator.
 */

import { CircleCheckBigIcon, CircleIcon, LoaderCircleIcon, OctagonIcon } from 'lucide-react';

export interface RuntimeStatusProps {
  state: string;
}

/**
 * Renders the state indicator shared by navigation and the application header.
 */
export function RuntimeStatus({ state }: RuntimeStatusProps) {
  if (state === 'running' || state === 'starting' || state === 'recovering') {
    return <LoaderCircleIcon className="animate-spin text-primary" />;
  }
  if (state === 'failed') {
    return <OctagonIcon className="text-destructive" />;
  }
  if (state === 'idle') {
    return <CircleCheckBigIcon className="text-success" />;
  }
  return <CircleIcon className="text-muted-foreground" />;
}
