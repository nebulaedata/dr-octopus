/**
 * @author Codex
 * @description Bilingual public message catalog for settings-domain error codes.
 * Covers permission configuration (agent-core permission system) and local model provider
 * management (pi-settings) surfaced through the Settings controllers.
 */

import { registerErrorMessages } from '../../lib/i18n/error-catalog.js';
import type { ErrorMessageCatalog } from '../../lib/i18n/error-catalog.js';

/**
 * Settings-domain message variants keyed by stable error code.
 */
export const settingsErrorMessages: ErrorMessageCatalog = {
  MODEL_PROVIDER_CAPABILITY_UNSUPPORTED: {
    en: 'This operation is not supported by the selected provider or model.',
    'zh-CN': '所选提供商或模型不支持此操作。',
  },
  INVALID_PERMISSION_CONFIG: {
    en: 'The permission configuration request is invalid.',
    'zh-CN': '无效的权限配置请求。',
  },
  INVALID_PERMISSION_SCOPE: {
    en: 'The permission configuration scope is invalid.',
    'zh-CN': '无效的权限配置范围。',
  },
  LOCAL_MODEL_NOT_FOUND: {
    en: 'The selected model is no longer available; detect models again.',
    'zh-CN': '所选模型已不可用，请重新检测模型。',
  },
  LOCAL_PROVIDER_NOT_FOUND: {
    en: 'This provider is not a configurable local model service.',
    'zh-CN': '该提供商不是可配置的本地模型服务。',
  },
  PERMISSION_CONFIG_BUSY: {
    en: 'The permission configuration is being saved; try again later.',
    'zh-CN': '权限配置正在保存，请稍后重试。',
  },
  PERMISSION_CONFIG_INVALID: [
    { en: 'The permission configuration is invalid.', 'zh-CN': '权限配置无效。' },
    {
      match: '权限配置文件不可读取',
      en: 'The permission configuration file is unreadable.',
      'zh-CN': '权限配置文件不可读取',
    },
    {
      match: '权限配置格式无效',
      en: 'The permission configuration format is invalid.',
      'zh-CN': '权限配置格式无效',
    },
    {
      match: '权限配置目录不能是符号链接',
      en: 'The permission configuration directory cannot be a symbolic link.',
      'zh-CN': '权限配置目录不能是符号链接',
    },
    {
      match: '请先修复全局权限配置',
      en: 'Fix the global permission configuration first.',
      'zh-CN': '请先修复全局权限配置',
    },
    {
      match: '权限配置不能超过 1 MiB',
      en: 'The permission configuration cannot exceed 1 MiB.',
      'zh-CN': '权限配置不能超过 1 MiB',
    },
  ],
};

/**
 * Merges the settings-domain catalog into the shared error-message registry at Server boot.
 */
export function registerSettingsErrorMessages(): void {
  registerErrorMessages('settings', settingsErrorMessages);
}
