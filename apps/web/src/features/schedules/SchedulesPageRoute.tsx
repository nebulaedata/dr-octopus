/**
 * @author Codex
 * @description Keeps the schedules page implementation deferred when sibling components are imported eagerly.
 */
import { lazy } from 'react';
import type { ComponentProps } from 'react';

const LazyPage = lazy(() => import('./SchedulesPage').then((module) => ({ default: module.SchedulesPage })));

/**
 * Preserves a concrete route component while deferring its implementation.
 */
export function SchedulesPage(props: ComponentProps<typeof LazyPage>) {
  return <LazyPage {...props} />;
}
