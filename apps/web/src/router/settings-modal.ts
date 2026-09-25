/**
 * @author Codex
 * @description Defines the validated Workbench search contract for route-masked Settings dialogs.
 */

import { z } from 'zod';

export const settingsPaths = [
  '/settings/model-providers',
  '/settings/default-model',
  '/settings/mcp',
  '/settings/knowledge',
  '/settings/memory',
  '/settings/jev',
  '/settings/schedules',
  '/settings/appearance/theme',
  '/settings/appearance/language',
  '/settings/appearance/shortcuts',
  '/settings/appearance/snippets',
  '/settings/permissions',
  '/settings/environment',
  '/settings/server',
  '/settings/extensions',
  '/settings/about',
] as const;

export type SettingsPath = (typeof settingsPaths)[number];

export const settingsModalSearchSchema = z.object({
  path: z.enum(settingsPaths),
  provider: z.string().optional(),
});

export type SettingsModalLocation = z.infer<typeof settingsModalSearchSchema>;
