/**
 * @author Codex
 * @description Centralizes stable configuration identities and the enabled restart notification list.
 */
export const MODEL_CONFIG_ROUTE = '/settings/model-providers';
export const RESTART_CONFIG_ROUTES: ReadonlySet<string> = new Set([MODEL_CONFIG_ROUTE]);
