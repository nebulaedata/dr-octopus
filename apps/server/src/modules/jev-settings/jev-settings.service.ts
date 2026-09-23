/**
 * @author Codex
 * @description Exposes revision-checked Jev configuration and a synthetic connectivity probe.
 */
import { evaluateJevChoice, listJevModels, JevSettingsStore } from '@octopus/agent';
import type { JevCredentialUpdate, JevSettingsUpdate } from '@octopus/shared/protocol';

export class JevSettingsService {
  private readonly store;
  /**
   * Use the same trusted Agent directory as runtime processes.
   */
  constructor(agentDir: string, environment?: NodeJS.ProcessEnv) {
    this.store = new JevSettingsStore(agentDir, environment);
  }
  /**
   * Read only the redacted configuration.
   */
  get() {
    return this.store.get();
  }
  /**
   * Save one complete configuration without returning its credential.
   */
  update(input: JevSettingsUpdate) {
    return this.store.update(input);
  }
  /**
   * Save the credential in the existing Agent environment without duplicating secret storage.
   */
  updateCredential(input: JevCredentialUpdate) {
    return this.store.updateCredential(input);
  }
  /**
   * Discover selectable models using the effective Agent environment credential.
   */
  models() {
    return listJevModels({ apiKey: this.store.getApiKey() ?? '' });
  }
  /**
   * Test saved credentials using synthetic data; this never enables Jev or sends conversation data.
   */
  async probe() {
    const { configuration } = await this.store.load();
    const result = await evaluateJevChoice(
      { ...configuration, timeoutMs: 1500 },
      'Hello!',
      {
        instructions: 'Is this text a greeting?',
        criteria: { greeting: 'A greeting', other: 'Not a greeting' },
      },
      { apiKey: this.store.getApiKey() ?? '' }
    );
    return { model: result.model, latencyMs: result.latencyMs };
  }
}
