/**
 * @author Codex
 * @description Owns independent image-service credentials and revision-fenced atomic configuration updates.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ImagegenConfigSchema, imagegenSettingsUpdateSchema } from '@octopus/shared/protocol';
import type { ImagegenConfig, ImagegenSettingsDto, ImagegenSettingsUpdate } from '@octopus/shared/protocol';

const pendingWrites = new Map<string, Promise<unknown>>();

export class ImagegenSettingsError extends Error {
  /**
   * Carries a safe domain code without request data or credentials.
   */
  constructor(public readonly code: 'IMAGEGEN_CONFLICT' | 'IMAGEGEN_INVALID' | 'IMAGEGEN_KEY_REQUIRED') {
    super(code);
  }
}

/**
 * Starts disabled with independent provider settings.
 */
function defaults(): ImagegenConfig {
  return {
    version: 1,
    enabled: false,
    activeProvider: 'openai',
    providers: {
      openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5', apiKey: '' },
      qwen: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-image-3.0-pro', apiKey: '' },
    },
  };
}

/**
 * Reads and validates the current configuration format without migration or fallback.
 */
async function readConfiguration(agentDir: string) {
  let raw: string;
  try {
    raw = await readFile(join(agentDir, 'imagegen.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    return { config: defaults(), revision: 'missing' };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ImagegenSettingsError('IMAGEGEN_INVALID');
  }
  const parsed = ImagegenConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new ImagegenSettingsError('IMAGEGEN_INVALID');
  }
  return {
    config: parsed.data,
    revision: createHash('sha256').update(raw).digest('hex'),
  };
}

/**
 * Returns credentials only to the local image execution boundary.
 */
export async function readImagegenConfig(agentDir: string): Promise<ImagegenConfig> {
  return (await readConfiguration(agentDir)).config;
}

/**
 * Projects one coherent revision without exposing saved keys.
 */
function project(config: ImagegenConfig, revision: string): ImagegenSettingsDto {
  /**
   * Replaces a stored credential with presence metadata.
   */
  const redact = ({ apiKey, ...provider }: ImagegenConfig['providers']['openai']) => ({
    ...provider,
    hasApiKey: Boolean(apiKey),
  });
  return {
    enabled: config.enabled,
    activeProvider: config.activeProvider,
    revision,
    providers: { openai: redact(config.providers.openai), qwen: redact(config.providers.qwen) },
  };
}

/**
 * Reads settings for Host configuration surfaces without credentials.
 */
export async function readImagegenSettings(agentDir: string): Promise<ImagegenSettingsDto> {
  const { config, revision } = await readConfiguration(agentDir);
  return project(config, revision);
}

/**
 * Merges a revision-checked update; omitted keys are retained and null explicitly removes a key.
 */
export async function updateImagegenSettings(
  agentDir: string,
  input: ImagegenSettingsUpdate
): Promise<ImagegenSettingsDto> {
  const key = resolve(agentDir);
  const operation = (pendingWrites.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const parsed = imagegenSettingsUpdateSchema.safeParse(input);
      if (!parsed.success) {
        throw new ImagegenSettingsError('IMAGEGEN_INVALID');
      }
      const change = parsed.data;
      const { config, revision } = await readConfiguration(key);
      if (change.revision !== revision) {
        throw new ImagegenSettingsError('IMAGEGEN_CONFLICT');
      }
      if (change.enabled !== undefined) {
        config.enabled = change.enabled;
      }
      if (change.activeProvider !== undefined) {
        config.activeProvider = change.activeProvider;
      }
      if (change.provider) {
        const { id, apiKey, ...provider } = change.provider;
        if (!(id === 'openai' ? /^gpt-image-/ : /^qwen-image(?:-|$)/).test(provider.model)) {
          throw new ImagegenSettingsError('IMAGEGEN_INVALID');
        }
        config.providers[id] = {
          ...provider,
          baseUrl: provider.baseUrl.replace(/\/+$/, ''),
          apiKey: apiKey === undefined ? config.providers[id].apiKey : (apiKey ?? ''),
        };
      }
      if (config.enabled && !config.providers[config.activeProvider].apiKey) {
        throw new ImagegenSettingsError('IMAGEGEN_KEY_REQUIRED');
      }
      const serialized = `${JSON.stringify(ImagegenConfigSchema.parse(config), null, 2)}\n`;
      await mkdir(key, { recursive: true });
      const temporary = join(key, `.imagegen-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(key, 'imagegen.json'));
      } finally {
        await rm(temporary, { force: true });
      }
      return project(config, createHash('sha256').update(serialized).digest('hex'));
    });
  pendingWrites.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingWrites.get(key) === operation) {
      pendingWrites.delete(key);
    }
  }
}
