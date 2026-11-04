/**
 * @author Codex
 * @description Exposes revision-checked Jev configuration and a synthetic connectivity probe.
 */
import { evaluateJevChoice, listJevModels, JevSettingsStore } from '@octopus/agent';
import { createAgentEnvironmentStore } from '@octopus/agent/environment';
import type { JevCredentialUpdate, JevSettingsSnapshot, JevSettingsUpdate } from '@octopus/shared/protocol';

export class JevSettingsService {
  private readonly store;
  private readonly environment;
  /**
   * Use the same trusted Agent directory as runtime processes.
   */
  constructor(
    agentDir: string,
    environment?: NodeJS.ProcessEnv,
    private readonly onCredentialCommitted?: () => void
  ) {
    this.store = new JevSettingsStore(agentDir, environment);
    this.environment = createAgentEnvironmentStore(agentDir, environment);
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
  async updateCredential(input: JevCredentialUpdate) {
    const previous = this.environment.load().revision;
    let snapshot: JevSettingsSnapshot;
    try {
      snapshot = await this.store.updateCredential(input);
    } catch (error) {
      // The SDK saves the environment before reading the separate Jev document for its response.
      // A failed response projection must not hide a committed credential change.
      let current = previous;
      try {
        current = this.environment.load().revision;
      } catch {
        /* Preserve the original SDK error when storage cannot confirm a new revision. */
      }
      if (current !== previous) {
        this.onCredentialCommitted?.();
      }
      throw error;
    }
    if (snapshot.environmentRevision !== input.revision) {
      this.onCredentialCommitted?.();
    }
    return snapshot;
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
