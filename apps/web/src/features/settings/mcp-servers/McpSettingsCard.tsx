/**
 * @author Codex
 * @description Groups one MCP configuration responsibility with a consistent heading and content surface.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@octopus/ui/components/card';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Shares the MCP panel's section hierarchy without introducing separate forms or save operations.
 */
export function McpSettingsCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          <h3>{title}</h3>
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}
