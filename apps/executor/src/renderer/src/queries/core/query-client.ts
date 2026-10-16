/**
 * @author Codex
 * @description Owns the one Renderer QueryClient and disables automatic side-effect retries.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
