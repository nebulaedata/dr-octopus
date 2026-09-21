/**
 * @author Codex
 * @description Defines permission action labels and mode names independently of React rendering.
 */
import type { Translate } from '@/i18n/use-i18n';

/**
 * Build the selectable permission actions with localized labels.
 */
export function getPermissionActions(t: Translate) {
  return [
    { value: 'inherit', label: t('settings.permissions.action.inherit', 'Default') },
    { value: 'allow', label: t('settings.permissions.action.allow', 'Allow') },
    { value: 'ask', label: t('settings.permissions.action.ask', 'Ask') },
    { value: 'deny', label: t('settings.permissions.action.deny', 'Deny') },
  ];
}

/**
 * Build tool-kind labels with localized names.
 */
export function getKindLabels(t: Translate) {
  return {
    read: t('settings.permissions.kind.read', 'Read'),
    write: t('settings.permissions.kind.write', 'Write'),
    shell: t('settings.permissions.kind.shell', 'Shell'),
    custom: t('settings.permissions.kind.custom', 'Other tools'),
    external: t('settings.permissions.kind.external', 'Outside workspace'),
  };
}

/**
 * Build run-mode labels with localized names.
 */
export function getModeLabels(t: Translate) {
  return {
    ask: t('settings.permissions.mode.ask', 'Ask for approval'),
    auto: t('settings.permissions.mode.auto', 'Auto-approve'),
    full: t('settings.permissions.mode.full', 'Full access'),
  };
}

/**
 * Render configured actions without exposing transport identifiers as primary labels.
 */
export function actionLabel(t: Translate, action?: string) {
  return (
    getPermissionActions(t).find((item) => item.value === action)?.label ??
    t('settings.permissions.action.perMode', 'Per mode')
  );
}
