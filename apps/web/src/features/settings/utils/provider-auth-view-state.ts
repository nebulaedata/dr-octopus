/**
 * @author Codex
 * @description Derives authentication-form behavior from the effective Provider method and current selection.
 */

import type { ModelProviderAuthDto, ModelProviderAuthMethod } from '@octopus/shared/protocol';

/**
 * Reports whether the selected method is the Provider's currently effective authentication method.
 *
 * @param auth Effective Provider authentication snapshot.
 * @param selectedMethod Method selected in the editable form.
 * @returns Whether the selected method is already authenticated.
 */
export function isProviderAuthMethodActive(
  auth: ModelProviderAuthDto,
  selectedMethod: ModelProviderAuthMethod | null
): boolean {
  return auth.configured && auth.activeMethod === selectedMethod;
}

/**
 * Reports whether the selected authentication method should expose its submit action.
 * API Keys remain replaceable even when they are already active because stored secrets are never refilled.
 *
 * @param auth Effective Provider authentication snapshot.
 * @param selectedMethod Method selected in the editable form.
 * @returns Whether authentication can be submitted from the current form state.
 */
export function canSubmitProviderAuth(
  auth: ModelProviderAuthDto,
  selectedMethod: ModelProviderAuthMethod | null
): boolean {
  return (
    selectedMethod !== null &&
    (selectedMethod === 'api_key' || !isProviderAuthMethodActive(auth, selectedMethod))
  );
}
