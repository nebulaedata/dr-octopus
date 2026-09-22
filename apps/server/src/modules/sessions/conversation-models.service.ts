/**
 * @author Codex
 * @description Resolves model-selection intent against refreshed Host metadata without creating Agent processes.
 */
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { ModelSelection } from '@octopus/shared/protocol';
import type { SettingsService } from '../settings/settings.service.js';

export class ConversationModelsService {
  /**
   * Reuses the Host's configured Provider catalog and effective configuration fingerprint.
   */
  constructor(
    private readonly settings: SettingsService,
    private readonly configuration: () => Promise<string>
  ) {}
  /**
   * Lists Host-owned candidates without creating any Session or Agent process.
   */
  async catalog() {
    await this.configuration();
    const [catalog, defaults] = await Promise.all([
      this.settings.listDefaultModelCandidates(),
      this.settings.getDefaultModel(),
    ]);
    return {
      models: catalog.candidates.map((item) => ({
        provider: item.providerId,
        id: item.modelId,
        name: item.modelName,
        input: item.input,
        reasoning: item.reasoning,
        ...(item.thinkingLevels ? { thinkingLevels: item.thinkingLevels } : {}),
      })),
      defaults,
    };
  }

  /**
   * Resolves intent at admission time; an unavailable explicit/default choice never silently changes.
   */
  async resolve(selection: ModelSelection) {
    const { models, defaults } = await this.catalog();
    const provider = selection.mode === 'explicit' ? selection.provider : defaults.providerId;
    const id = selection.mode === 'explicit' ? selection.modelId : defaults.modelId;
    const selected =
      provider && id
        ? models.find((model) => model.provider === provider && model.id === id)
        : !defaults.configured && models.length === 1
          ? models[0]
          : undefined;
    if (!selected) {
      throw new ApplicationError('CONVERSATION_MODEL_REQUIRED', 'Choose an available model before sending.', {
        statusCode: 409,
      });
    }
    return selected;
  }
}
