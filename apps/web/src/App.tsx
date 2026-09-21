/**
 * @author Codex
 * @description 渲染 Dr.Octopus Web Router 与应用级 Providers
 */
import { Toaster } from '@octopus/ui/components/toast';
import { RouterProvider } from '@tanstack/react-router';
import { AppProvider } from './AppProvider';
import { router } from './router';

/**
 * Composes application Providers with the typed Router boundary.
 */
function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AppProvider>
  );
}

export default App;
