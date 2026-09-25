/**
 * @author Codex
 * @description Resolves image models against Pi providers and declared model capabilities.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import type { ImagesModel, ImagesApi, Model, Api } from '@earendil-works/pi-ai';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ImagegenCandidate } from '@octopus/shared/protocol';

export interface ImagegenCatalogEntry {
  candidate: ImagegenCandidate;
  model: ImagesModel<ImagesApi>;
  authModel?: Model<Api>;
}

/**
 * Combines Pi's image catalog with explicit capability metadata and known OpenAI image models.
 */
export async function getImagegenCatalog(
  agentDir: string,
  registry: ModelRegistry
): Promise<ImagegenCatalogEntry[]> {
  let metadata: Record<string, Record<string, { imageGeneration?: boolean }>> = {};
  let configured: Record<string, unknown> = {};
  let customProviders: Record<string, unknown> = {};
  try {
    const document = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8')) as {
      octopusModelCapabilities?: typeof metadata;
      providers?: Record<string, unknown>;
      octopusLocalProviders?: Record<string, unknown>;
    };
    metadata = document.octopusModelCapabilities ?? {};
    configured = document.providers ?? {};
    customProviders = document.octopusLocalProviders ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const entries = new Map<string, ImagegenCatalogEntry>();
  const builtins = builtinImagesModels();
  const models: ImagesModel<ImagesApi>[] = [...builtins.getModels()];
  for (const id of ['gpt-image-1', 'gpt-image-1.5']) {
    models.push({
      id,
      name: id,
      provider: 'openai',
      api: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      input: ['text', 'image'],
      output: ['image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  }
  for (const model of registry.getAll()) {
    const marked = metadata[model.provider]?.[model.id]?.imageGeneration;
    const geminiImage = model.provider === 'google' && model.id.includes('-image');
    if (marked === true || (marked === undefined && geminiImage)) {
      models.push({
        ...model,
        api: model.provider === 'google' ? 'google-gemini' : 'openai-images',
        output: ['image'],
      });
    }
  }
  for (const image of models) {
    const provider = registry.getProvider(image.provider);
    if (!provider || metadata[image.provider]?.[image.id]?.imageGeneration === false) {
      continue;
    }
    const native = ['openai', 'google', 'openrouter'].includes(image.provider);
    const custom =
      Object.hasOwn(customProviders, image.provider) ||
      (!native &&
        (Object.hasOwn(configured, image.provider) ||
          registry.getRegisteredProviderConfig(image.provider) !== undefined));
    const adapter =
      !custom && image.provider === 'openrouter'
        ? 'openrouter'
        : !custom && image.provider === 'google'
          ? 'google-gemini'
          : 'openai-images';
    if (!custom && !['openai', 'google', 'openrouter'].includes(image.provider)) {
      continue;
    }
    const authModel: Model<Api> = registry.find(image.provider, image.id) ?? {
      ...image,
      api: 'openai-completions',
      reasoning: false,
      contextWindow: 1,
      maxTokens: 1,
      baseUrl: provider.baseUrl ?? image.baseUrl,
    };
    const available =
      registry.getProviderAuthStatus(image.provider).configured && !registry.isUsingOAuth(authModel);
    const model = {
      ...image,
      api: adapter === 'openrouter' ? 'openrouter-images' : adapter,
      baseUrl: authModel.baseUrl,
    };
    entries.set(`${image.provider}\0${image.id}`, {
      model,
      authModel,
      candidate: {
        providerId: image.provider,
        modelId: image.id,
        adapter,
        name: image.name,
        providerName: provider.name,
        available,
        supportsReferenceImages: image.input.includes('image'),
        requiresProtocolConfirmation: custom,
      },
    });
  }
  return [...entries.values()];
}
