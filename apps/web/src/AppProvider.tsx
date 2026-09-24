/**
 * @author Codex
 * @description 装配所有 Web 页面共享的 Query 与 UI 上下文
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@octopus/ui/components/theme-provider';
import { TooltipProvider } from '@octopus/ui/components/tooltip';
import { MarkdownRenderTheme } from './components/MarkdownRenderTheme';
import { queryClient } from '@/queries/core/query-client';
import type { PropsWithChildren } from 'react';

/** 全局日期语言由 src/i18n 模块随界面语言统一切换。 */

/**
 * 提供跨路由复用的进程级 Query 客户端和 UI 上下文。
 */
export function AppProvider({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <MarkdownRenderTheme />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-left" />}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
