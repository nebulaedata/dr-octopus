/**
 * @author Codex
 * @description Defines the compile-time extension contract for session tool result renderers.
 */

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Translate } from '@/i18n/use-i18n';
import type { ToolProjection } from '@/stores/session';

export interface ToolRendererProps {
  tool: ToolProjection;
}

export interface ToolRendererDefinition {
  names: readonly string[];
  component: ComponentType<ToolRendererProps>;
  label?: Record<string, string>;
  icon?: LucideIcon;
  /**
   * Collapsed-card summary callback; the tool stays first so existing `(tool)` implementations
   * remain assignable, with the active translator supplied as the second argument.
   */
  summarize?: (tool: ToolProjection, t: Translate) => string | undefined;
}
