/**
 * @author Codex
 * @description Persists Host-owned local provider metadata and Pi model configuration in one atomic document.
 */
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UpdateModelCapabilitiesBody, LocalProviderConfigurationDto } from '@octopus/shared/protocol';

export interface LocalProviderRecord extends LocalProviderConfigurationDto {
  name: string;
}
interface ModelDocument {
  providers: Record<string, Record<string, unknown>>;
  octopusLocalProviders?: Record<string, LocalProviderRecord>;
}
const queues = new Map<string, Promise<unknown>>();

/**
 * Reads the complete document, preserving unrelated configuration and rejecting corrupt files.
 */
async function readDocument(path: string): Promise<ModelDocument> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as ModelDocument;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value.providers !== undefined &&
        (typeof value.providers !== 'object' || !value.providers || Array.isArray(value.providers)))
    ) {
      throw new Error('Invalid Pi models.json document.');
    }
    value.providers ??= {};
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { providers: {} };
    }
    throw error;
  }
}

/**
 * Reads saved local providers, including configurations originally created by onboarding.
 */
export async function readLocalProviders(path: string): Promise<Record<string, LocalProviderRecord>> {
  const document = await readDocument(path);
  const records = { ...document.octopusLocalProviders };
  for (const runtime of ['ollama', 'vllm', 'lmstudio'] as const) {
    const id = `octopus-${runtime}`;
    const provider = document.providers[id];
    if (!records[id] && typeof provider?.baseUrl === 'string') {
      const models = provider.models as Array<{ id: string }> | undefined;
      records[id] = {
        name: localProviderName(provider, runtime),
        runtime,
        baseUrl: runtime === 'ollama' ? provider.baseUrl.replace(/\/v1\/?$/, '') : provider.baseUrl,
        ...(models?.[0] ? { modelId: models[0].id } : {}),
      };
    }
  }
  return records;
}

/**
 * Serializes read/merge/write operations per document; drafts never expose fictitious Pi models.
 * @returns Whether the persisted Pi Provider configuration changed; metadata-only drafts return false.
 */
export async function saveLocalProvider(
  path: string,
  id: string,
  record: LocalProviderRecord
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    document.octopusLocalProviders = { ...document.octopusLocalProviders, [id]: record };
    if (record.modelId) {
      const root = record.baseUrl.replace(/\/+$/, '');
      document.providers[id] = {
        ...document.providers[id],
        name: record.name,
        baseUrl: root.endsWith('/v1') ? root : `${root}/v1`,
        api: 'openai-completions',
        apiKey: id,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [
          {
            name: `${record.modelId} (Local)`,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            ...((document.providers[id]?.models as Array<Record<string, unknown>> | undefined)?.find(
              (model) => model.id === record.modelId
            ) ?? { reasoning: false, input: ['text'] }),
            id: record.modelId,
          },
        ],
      };
    }
  });
}

/**
 * Updates only Pi capability metadata, preserving provider credentials and all other model settings.
 */
export async function saveModelCapabilities(
  path: string,
  id: string,
  modelId: string,
  input: UpdateModelCapabilitiesBody
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    const provider = document.providers[id];
    if (!provider) {
      throw new Error('Provider configuration no longer exists.');
    }
    const models = provider.models as Array<Record<string, unknown>> | undefined;
    const model = models?.find((candidate) => candidate.id === modelId);
    if (model) {
      Object.assign(model, input);
      if (document.octopusLocalProviders?.[id]) {
        model.compat = { ...(model.compat as object), supportsReasoningEffort: input.reasoning };
      }
    }
    const overrides = (provider.modelOverrides ?? {}) as Record<string, object>;
    if (!model || overrides[modelId]) {
      provider.modelOverrides = { ...overrides, [modelId]: { ...overrides[modelId], ...input } };
    }
  });
}

/**
 * Serializes every Host write to models.json and atomically replaces the merged document.
 */
async function updateProviderDocument(
  path: string,
  id: string,
  update: (document: ModelDocument) => void
): Promise<boolean> {
  const operation = (queues.get(path) ?? Promise.resolve()).then(async () => {
    const document = await readDocument(path);
    const previous = JSON.stringify(document.providers[id]);
    update(document);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return previous !== JSON.stringify(document.providers[id]);
  });
  const settled = operation.catch(() => undefined);
  queues.set(path, settled);
  try {
    return await operation;
  } finally {
    if (queues.get(path) === settled) {
      queues.delete(path);
    }
  }
}

/**
 * Preserves the ordered localProviderName selection rules.
 */
function localProviderName(provider: { name?: unknown }, runtime: string): string {
  if (typeof provider.name === 'string') {
    return provider.name;
  } else {
    if (runtime === 'lmstudio') {
      return 'LM Studio';
    } else {
      if (runtime === 'vllm') {
        return 'vLLM';
      } else {
        return 'Ollama';
      }
    }
  }
}
