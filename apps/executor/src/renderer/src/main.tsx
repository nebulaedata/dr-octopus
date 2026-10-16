/**
 * @author Codex
 * @description Boots the system-aware React theme and binds one window-scoped status subscription to the Query cache.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from '@octopus/ui/components/toast';
import { TooltipProvider } from '@octopus/ui/components/tooltip';
import { router } from '@/routes/router';
import { bindRuntimeStatus } from '@/queries/runtime-queries';
import { queryClient } from '@/queries/core/query-client';
import '@octopus/ui/globals.css';
import './executor.css';

const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
/**
 * Applies Chromium's effective system or user-selected theme before mounting and on live changes.
 */
function updateTheme(): void {
  document.documentElement.classList.toggle('dark', themeMedia.matches);
}
updateTheme();
themeMedia.addEventListener('change', updateTheme);

const unsubscribe = bindRuntimeStatus(queryClient);
window.addEventListener(
  'beforeunload',
  () => {
    themeMedia.removeEventListener('change', updateTheme);
    unsubscribe?.();
    queryClient.clear();
  },
  { once: true }
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    themeMedia.removeEventListener('change', updateTheme);
    unsubscribe?.();
  });
}

const element = document.getElementById('root');
if (!element) {
  throw new Error('Executor mount element is missing.');
}
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Toaster timeout={3500} limit={3}>
        <TooltipProvider delay={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </Toaster>
    </QueryClientProvider>
  </StrictMode>
);
