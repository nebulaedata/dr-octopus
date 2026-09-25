/**
 * @author Codex
 * @description Executes the configured image operation using a fresh immutable model and auth snapshot.
 */
import { createImagesModels, createImagesProvider } from '@earendil-works/pi-ai';
import { openrouterImagesProvider } from '@earendil-works/pi-ai/providers/openrouter-images';
import { readImagegenConfig } from '../lib/configuration.js';
import { getImagegenCatalog } from '../lib/catalog.js';
import { generateDirectImages } from '../lib/providers.js';
import { sanitizeImageDiagnostic } from '../lib/diagnostics.js';
import { publishImages, readImageReferences, resolveImagePath } from '../lib/files.js';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { ImagegenResult } from '@octopus/shared/protocol';

/**
 * Resolves and executes one generation without switching the conversation model or retrying billing operations.
 */
export async function generateImage(input: {
  agentDir: string;
  cwd: string;
  registry: ModelRegistry;
  prompt: string;
  referenceImages?: string[];
  outputDirectory?: string;
  signal?: AbortSignal;
}) {
  if (!input.prompt.trim()) {
    throw new Error('An image prompt is required.');
  }
  const config = await readImagegenConfig(input.agentDir);
  if (!config) {
    throw new Error('Configure an image model in Settings → Default model before generating images.');
  }
  const refreshed = await input.registry.refresh({
    providers: [config.providerId],
    allowNetwork: false,
    signal: input.signal,
  });
  input.signal?.throwIfAborted();
  if (refreshed.aborted || refreshed.errors.has(config.providerId) || input.registry.getError()) {
    throw new Error(
      'Unable to refresh the image provider configuration. Fix the model settings before retrying.'
    );
  }
  const entry = (await getImagegenCatalog(input.agentDir, input.registry)).find(
    ({ candidate }) =>
      candidate.providerId === config.providerId &&
      candidate.modelId === config.modelId &&
      candidate.adapter === config.adapter
  );
  if (!entry?.candidate.available) {
    throw new Error(
      'The configured image model is unavailable. Check its capabilities and API Key in Settings.'
    );
  }
  if (input.referenceImages?.length && !entry.candidate.supportsReferenceImages) {
    throw new Error('The configured image model does not support reference images.');
  }
  const references = await readImageReferences(input.cwd, input.referenceImages ?? [], input.signal);
  const directory = input.outputDirectory ?? 'generated-images';
  await resolveImagePath(input.cwd, directory);
  const auth = entry.authModel ? await input.registry.getApiKeyAndHeaders(entry.authModel) : undefined;
  if (auth && !auth.ok) {
    throw new Error('Unable to resolve the image provider credential.');
  }
  const apiKey = auth?.ok ? auth.apiKey : await input.registry.getApiKeyForProvider(config.providerId);
  if (!apiKey) {
    throw new Error('An API Key is required for the configured image provider.');
  }
  const provider = input.registry.getProvider(config.providerId)!;
  const models = createImagesModels();
  models.setProvider(
    config.adapter === 'openrouter'
      ? openrouterImagesProvider()
      : createImagesProvider({
          id: config.providerId,
          name: provider.name,
          auth: provider.auth,
          models: [entry.model],
          api: { generateImages: generateDirectImages },
        })
  );
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(180_000)]);
  const model = {
    ...entry.model,
    api: config.adapter === 'openrouter' ? entry.model.api : config.adapter,
    ...(auth?.ok && auth.baseUrl ? { baseUrl: auth.baseUrl } : {}),
  };
  const response = await models
    .generateImages(
      model,
      { input: [{ type: 'text', text: input.prompt }, ...references] },
      {
        apiKey,
        ...(auth?.ok ? { headers: auth.headers, env: auth.env } : {}),
        signal,
        maxRetries: 0,
        timeoutMs: 180_000,
      }
    )
    .catch((error: unknown) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [],
      stopReason: 'error' as const,
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      usage: undefined,
    }));
  signal.throwIfAborted();
  if (response.stopReason !== 'stop') {
    if (response.stopReason === 'aborted') {
      throw new Error('Image generation was cancelled.');
    }
    const sensitive = [
      apiKey,
      input.prompt,
      ...references.map((part) => part.data),
      ...Object.values(model.headers ?? {}).filter((value): value is string => typeof value === 'string'),
      ...Object.values(auth?.ok ? (auth.headers ?? {}) : {}).filter(
        (value): value is string => typeof value === 'string'
      ),
    ];
    const diagnostic = sanitizeImageDiagnostic(
      response.errorMessage || 'The provider returned no error details.',
      sensitive
    );
    const operation = references.length ? 'reference edit' : 'text to image';
    throw new Error(
      `Image generation failed (${config.adapter}; ${operation}; model=${config.modelId}). ${diagnostic}`
    );
  }
  const images = await publishImages(
    input.cwd,
    directory,
    response.output.filter((part): part is ImageContent => part.type === 'image'),
    signal
  );
  const details: ImagegenResult = {
    version: 1,
    providerId: response.provider,
    modelId: response.model,
    images,
  };
  return {
    content: [
      {
        type: 'text' as const,
        text: images
          .map((image) => `${image.path} (${image.width}×${image.height}, ${image.mimeType})`)
          .join('\n'),
      },
      ...response.output
        .filter((part) => part.type === 'text')
        .map((part) => ({ type: 'text' as const, text: part.text.slice(0, 8000) })),
    ],
    details,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}
