/**
 * @author Codex
 * @description Executes the configured image operation using a fresh immutable model and auth snapshot.
 */
import { readImagegenConfig } from '../lib/configuration.js';
import { generateDirectImages } from '../lib/providers.js';
import { sanitizeImageDiagnostic } from '../lib/diagnostics.js';
import { publishImages, readImageReferences, resolveImagePath } from '../lib/files.js';
import type { ImageContent, ImagesModel, ImagesApi } from '@earendil-works/pi-ai';
import type { ImagegenResult } from '@octopus/shared/protocol';

/**
 * Resolves and executes one generation without switching the conversation model or retrying billing operations.
 */
export async function generateImage(input: {
  agentDir: string;
  cwd: string;
  prompt: string;
  referenceImages?: string[];
  outputDirectory?: string;
  signal?: AbortSignal;
}) {
  if (!input.prompt.trim()) {
    throw new Error('An image prompt is required.');
  }
  const config = await readImagegenConfig(input.agentDir);
  if (!config.enabled) {
    throw new Error(
      'Enable and configure an image service in Settings → Image service before generating images.'
    );
  }
  const providerId = config.activeProvider;
  const provider = config.providers[providerId];
  const apiKey = provider.apiKey;
  if (!apiKey) {
    throw new Error('An API Key is required for the configured image service.');
  }
  if (!(providerId === 'openai' ? /^gpt-image-/ : /^qwen-image(?:-|$)/).test(provider.model)) {
    throw new Error('The configured image model is unsupported.');
  }
  if (
    providerId === 'qwen' &&
    input.referenceImages?.length &&
    (!/^qwen-image-(?:[23]\.0|edit)/.test(provider.model) || input.referenceImages.length > 3)
  ) {
    throw new Error(
      'This Qwen model does not support these reference images. Use an editing model with up to 3 references.'
    );
  }
  const references = await readImageReferences(input.cwd, input.referenceImages ?? [], input.signal);
  const directory = input.outputDirectory ?? 'generated-images';
  await resolveImagePath(input.cwd, directory);
  const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(180_000)]);
  const model: ImagesModel<ImagesApi> = {
    id: provider.model,
    name: provider.model,
    provider: providerId,
    api: providerId === 'qwen' ? 'qwen-images' : 'openai-images',
    baseUrl: provider.baseUrl,
    input: ['text', 'image'],
    output: ['image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const response = await generateDirectImages(
    model,
    { input: [{ type: 'text', text: input.prompt }, ...references] },
    { apiKey, signal, maxRetries: 0, timeoutMs: 180_000 }
  ).catch((error: unknown) => ({
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
    const sensitive = [apiKey, input.prompt, ...references.map((part) => part.data)];
    const diagnostic = sanitizeImageDiagnostic(
      response.errorMessage || 'The provider returned no error details.',
      sensitive
    );
    const operation = references.length ? 'reference edit' : 'text to image';
    throw new Error(`Image generation failed (${model.api}; ${operation}; model=${model.id}). ${diagnostic}`);
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
