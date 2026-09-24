/**
 * @author Codex
 * @description Projects localized exact-name labels without selecting React renderers.
 */
import type { Translate } from '@/i18n/use-i18n';

/**
 * Resolves the localized display label for custom tools whose renderer covers several names.
 */
export function customToolLabel(t: Translate, toolName: string): string | undefined {
  switch (toolName) {
    case 'memory_recall':
      return t('session.toolCard.labels.memoryRecall', 'Recall memory');
    case 'memory_read':
      return t('session.toolCard.labels.memoryRead', 'Read memory');
    default:
      return undefined;
  }
}
