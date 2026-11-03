/**
 * @author Codex
 * @description Owns explicit local credential persistence with endpoint binding and trusted-context-only storage access.
 */
// Persisted workflow-prefixed keys remain stable so saved settings, credentials and consent survive this module move.
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { skillBudgetSchema, skillBudgetDefaults, type SkillBudget } from '../builtin-agent/skill-budget';
import {
  modelEndpointKey,
  modelSettingsSchema,
  type ModelSettings,
  type ModelSettingsSnapshot,
} from './model-settings-messages';

const credentialsSchema = z.record(z.string(), z.string().min(1).max(4096));
const consentsSchema = z.record(z.string(), z.number().int().positive());

/**
 * Serializes credential mutations so overlapping saves/clears cannot resurrect an older key.
 * Only trusted background services call this repository; no public method projects secret values to Popup.
 */
export class ModelSettingsRepository {
  private access?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Restricts the entire local area before reading or writing any saved secret.
   */
  private secure(): Promise<void> {
    this.access ??= browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    return this.access;
  }

  /**
   * Rejects malformed storage instead of silently discarding saved credentials.
   */
  private async read(): Promise<Record<string, string>> {
    await this.secure();
    const value = (await browser.storage.local.get('workflowCredentials')).workflowCredentials;
    if (value === undefined) {
      return {};
    }
    const parsed = credentialsSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error('WORKFLOW_STORAGE');
    }
    return parsed.data;
  }

  /**
   * Loads explicit consent for the current redacted-recording contract; missing or unknown grants never authorize sending.
   */
  private async readConsents(): Promise<Record<string, number>> {
    await this.secure();
    const stored = (await browser.storage.local.get('workflowConsents')).workflowConsents;
    if (stored === undefined) {
      return {};
    }
    const parsed = consentsSchema.safeParse(stored);
    if (!parsed.success) {
      throw new Error('WORKFLOW_STORAGE');
    }
    return parsed.data;
  }

  /**
   * Checks the exact normalized endpoint before every organization task, including after UI preflight.
   */
  async canSend(baseUrl: string): Promise<boolean> {
    await this.queue;
    return (await this.readConsents())[modelEndpointKey(baseUrl)] === 2;
  }

  /**
   * Remembers an explicit confirmation; revocation uses the same serialized authority as configuration saves.
   */
  setConsent(baseUrl: string, allowed: boolean): Promise<void> {
    return this.serial(async () => {
      const grants = await this.readConsents();
      if (allowed) {
        grants[modelEndpointKey(baseUrl)] = 2;
      } else {
        delete grants[modelEndpointKey(baseUrl)];
      }
      if (Object.keys(grants).length > 100) {
        throw new Error('WORKFLOW_LIMIT');
      }
      await browser.storage.local.set({ workflowConsents: grants });
    });
  }

  /**
   * Publishes each complete read-modify-write transaction in invocation order.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Supplies only a presence flag to settings UI.
   */
  async hasCredential(baseUrl: string): Promise<boolean> {
    await this.queue;
    return Boolean((await this.read())[modelEndpointKey(baseUrl)]);
  }

  /**
   * Resolves an explicitly supplied one-request key, otherwise the exact endpoint's stored key.
   * An empty explicit string means unauthenticated access, not fallback to another endpoint.
   */
  async resolve(baseUrl: string, supplied?: string): Promise<string> {
    if (supplied !== undefined) {
      return supplied;
    }
    await this.queue;
    return (await this.read())[modelEndpointKey(baseUrl)] ?? '';
  }

  /**
   * Saves metadata and an optional credential together; omitted credentials preserve the existing endpoint key.
   */
  save(
    settings: ModelSettings,
    apiKey?: string,
    consent?: boolean,
    expectedRevision?: string,
    limits?: SkillBudget
  ): Promise<void> {
    return this.serial(async () => {
      const revision =
        (await browser.storage.local.get('workflowSettingsRevision')).workflowSettingsRevision ?? 'initial';
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw Error('SETTINGS_CONFLICT');
      }
      const keys = await this.read();
      const grants = await this.readConsents();
      const id = modelEndpointKey(settings.baseUrl);
      if (apiKey !== undefined) {
        if (apiKey) {
          keys[id] = apiKey;
        } else {
          delete keys[id];
        }
      }
      if (consent !== undefined) {
        if (consent) {
          grants[id] = 2;
        } else {
          delete grants[id];
        }
      }
      if (Object.keys(keys).length > 100 || Object.keys(grants).length > 100) {
        throw new Error('WORKFLOW_LIMIT');
      }
      const savedLimits = skillBudgetSchema.parse(
        limits ??
          (await browser.storage.local.get('skillExecutionLimits')).skillExecutionLimits ??
          skillBudgetDefaults
      );
      await browser.storage.local.set({
        workflowSettings: settings,
        skillExecutionLimits: savedLimits,
        workflowSettingsRevision: crypto.randomUUID(),
        workflowCredentials: keys,
        workflowConsents: grants,
      });
    });
  }

  /**
   * Reads one consistent public snapshot after prior saves; never includes saved secret values.
   */
  snapshot(): Promise<ModelSettingsSnapshot> {
    return this.serial(async () => {
      const keys = await this.read();
      const grants = await this.readConsents();
      const stored = await browser.storage.local.get([
        'workflowSettings',
        'workflowSettingsRevision',
        'skillExecutionLimits',
      ]);
      const parsed = modelSettingsSchema.safeParse(stored.workflowSettings);
      const settings = parsed.success ? parsed.data : null;
      const endpoint = settings ? modelEndpointKey(settings.baseUrl) : undefined;
      return {
        settings,
        limits: skillBudgetSchema.parse(stored.skillExecutionLimits ?? skillBudgetDefaults),
        revision: z.string().parse(stored.workflowSettingsRevision ?? 'initial'),
        hasKey: Boolean(endpoint && keys[endpoint]),
        canSend: Boolean(endpoint && grants[endpoint] === 2),
      };
    });
  }

  /**
   * Deletes only the explicitly selected endpoint's key; metadata and other endpoints are retained.
   */
  clear(baseUrl: string, expectedRevision?: string): Promise<void> {
    return this.serial(async () => {
      const revision =
        (await browser.storage.local.get('workflowSettingsRevision')).workflowSettingsRevision ?? 'initial';
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw Error('SETTINGS_CONFLICT');
      }
      const keys = await this.read();
      delete keys[modelEndpointKey(baseUrl)];
      await browser.storage.local.set({
        workflowCredentials: keys,
        workflowSettingsRevision: crypto.randomUUID(),
      });
    });
  }
}
