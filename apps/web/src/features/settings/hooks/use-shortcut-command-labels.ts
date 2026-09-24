/**
 * @author Claude
 * @description Resolves localized shortcut command labels through literal t() calls so i18next-cli extraction stays static.
 */

import { useI18n } from '@/i18n/use-i18n';
import type { ShortcutCommandId } from '@/lib/shortcuts';

/**
 * Returns the localized display label of every catalog command.
 *
 * Labels are written as literal t() calls under the `settings.shortcuts.commands.*` prefix rather
 * than catalog-driven dynamic keys: i18next-cli only extracts static call sites, and the
 * `Record<ShortcutCommandId, string>` return type makes TypeScript fail the build when a
 * new catalog command ships without a label.
 *
 * @returns Mapping from command ID to its localized label.
 */
export function useShortcutCommandLabels(): Record<ShortcutCommandId, string> {
  const { t } = useI18n();
  return {
    'voice.toggle': t('settings.shortcuts.commands.voiceToggle', 'Voice input toggle'),
    'composer.focus': t('settings.shortcuts.commands.focusComposer', 'Focus composer'),
    'composer.send': t('settings.shortcuts.commands.sendMessage', 'Send message'),
    'composer.newline': t('settings.shortcuts.commands.insertNewline', 'Insert newline while typing'),
    'session.stop': t('settings.shortcuts.commands.stopGeneration', 'Stop generation'),
    'session.previous': t('settings.shortcuts.commands.previousSession', 'Previous session'),
    'session.next': t('settings.shortcuts.commands.nextSession', 'Next session'),
    'session.new': t('settings.shortcuts.commands.newSession', 'New session'),
    'layout.toggleLeftSidebar': t('settings.shortcuts.commands.toggleLeftSidebar', 'Toggle left sidebar'),
    'layout.toggleRightPanel': t('settings.shortcuts.commands.toggleRightPanel', 'Toggle right file panel'),
  };
}
