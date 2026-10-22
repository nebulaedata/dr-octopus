/**
 * @author Codex
 * @description Owns authoritative project settings without importing or falling back to previous layouts.
 */
import { z } from 'zod';
import {
  defaultToolPolicySettings,
  toolPolicySettingsSchema,
  type ToolPolicySettings,
} from '../contracts/tool-policy';
import { settingsInputSchema, type SettingsInput } from '../contracts/connection-settings';
import type { NativeFileCommit } from '../runtime/basic/native-file-commit';
import { SettingsPublication } from './settings-publication';

const recordSchema = settingsInputSchema.omit({ deviceName: true }).extend({
  identityInitialized: z.literal(true).optional(),
  preferencesSaved: z.boolean(),
  toolPolicies: toolPolicySettingsSchema.default(defaultToolPolicySettings),
});

export class ConnectionSettings {
  private value: z.infer<typeof recordSchema> = {
    ...settingsInputSchema.parse({ port: 19876, networkAddress: null }),
    preferencesSaved: false,
    toolPolicies: structuredClone(defaultToolPolicySettings),
  };

  /**
   * Keeps settings state detached from its private publication implementation.
   */
  private constructor(private readonly publication: SettingsPublication) {}

  /**
   * Opens only the selected project settings; isolated callers supply their own project root.
   * Previous AppData records are never read or automatically imported.
   */
  static async open(native: NativeFileCommit, projectRoot: string): Promise<ConnectionSettings> {
    const publication = new SettingsPublication(native, projectRoot);
    const owner = new ConnectionSettings(publication);
    const formal = await publication.open();
    if (formal !== null) {
      owner.value = recordSchema.parse(JSON.parse(formal));
      return owner;
    }
    return owner;
  }

  /**
   * Returns detached policy settings independently of UI and listener preferences.
   */
  readToolPolicies(): ToolPolicySettings {
    return structuredClone(this.value.toolPolicies);
  }

  /**
   * Publishes a policy independently of listener drafts without losing other settings.
   */
  async saveToolPolicies(input: ToolPolicySettings): Promise<void> {
    const next = { ...this.value, toolPolicies: toolPolicySettingsSchema.parse(input) };
    await this.publication.save(JSON.stringify(next, null, 2) + '\n');
    this.value = next;
  }

  /**
   * Indicates whether identity evidence is initialized.
   */
  hasIdentity(): boolean {
    return this.value.identityInitialized === true;
  }

  /**
   * Returns a detached snapshot so edits cannot mutate persisted or active Runtime configuration.
   */
  read(): SettingsInput & { saved: boolean } {
    return { ...settingsInputSchema.parse(this.valueForInput()), saved: this.value.preferencesSaved };
  }

  /**
   * Selects public preferences without exposing internal initialization markers.
   */
  private valueForInput(): SettingsInput {
    return {
      port: this.value.port,
      networkAddress: this.value.networkAddress,
      themeSource: this.value.themeSource,
      closeBehavior: this.value.closeBehavior,
      transfer: structuredClone(this.value.transfer),
    };
  }

  /**
   * Publishes preferences and limits before acknowledging, preserving the device initialization marker.
   */
  async save(input: SettingsInput, initializeIdentity = false): Promise<void> {
    const settings = settingsInputSchema.parse(input);
    delete settings.deviceName;
    const next = recordSchema.parse({
      ...settings,
      toolPolicies: this.value.toolPolicies,
      preferencesSaved: this.value.preferencesSaved || !initializeIdentity,
      ...(this.value.identityInitialized || initializeIdentity ? { identityInitialized: true } : {}),
    });
    await this.publication.save(JSON.stringify(next, null, 2) + '\n');
    this.value = next;
  }
}
