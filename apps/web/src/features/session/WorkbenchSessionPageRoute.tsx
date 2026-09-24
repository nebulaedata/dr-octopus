/**
 * @author Codex
 * @description Keeps the session page implementation deferred when sibling components are imported eagerly.
 */
import { lazy } from 'react';

const LazyPage = lazy(() =>
  import('./WorkbenchSessionPage').then((module) => ({ default: module.WorkbenchSessionPage }))
);

/**
 * Preserves a concrete route component while deferring its implementation.
 */
export function WorkbenchSessionPage() {
  return <LazyPage />;
}
