/**
 * @author Codex
 * @description Persists user-added provider metadata and Pi model configuration in one atomic document.
 */
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  UpdateModelCapabilitiesBody,
  CustomProviderConfigurationDto,
  ModelInterface,
} from '@octopus/shared/protocol';

export interface CustomProviderRecord extends CustomProviderConfigurationDto {
  name: string;
}
interface ModelDocument {
  providers: Record<string, Record<string, unknown>>;
  /** Persisted Pi document key used by existing installations. */
  octopusLocalProviders?: Record<string, CustomProviderRecord>;
  /** Host model capabilities kept outside Pi's inference model schema. */
  octopusModelCapabilities?: Record<
    string,
    Record<string, { imageGeneration: boolean; interfaces?: ModelInterface[] }>
  >;
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
 * Reads saved custom providers, including local configurations originally created by onboarding.
 */
export async function readCustomProviderMetadata(path: string) {
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
  return { records, imageGeneration: document.octopusModelCapabilities ?? {} };
}

/**
 * Reads provider records for mutation paths that do not need model capabilities.
 */
export async function readCustomProviders(path: string): Promise<Record<string, CustomProviderRecord>> {
  return (await readCustomProviderMetadata(path)).records;
}

/**
 * Persists every discovered model, preserving capability edits for matching IDs; legacy single-model records remain readable.
 * @returns Whether the persisted Pi Provider configuration changed; metadata-only drafts return false.
 */
export async function saveCustomProvider(
  path: string,
  id: string,
  record: CustomProviderRecord,
  discoveredModels?: ReadonlyArray<{ id: string; name?: string }>
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    document.octopusLocalProviders = { ...document.octopusLocalProviders, [id]: record };
    const models = discoveredModels ?? (record.modelId ? [{ id: record.modelId }] : undefined);
    if (models !== undefined) {
      const root = record.baseUrl.replace(/\/+$/, '');
      const local = ['ollama', 'vllm', 'lmstudio'].includes(record.runtime);
      const existingModels = document.providers[id]?.models as Array<Record<string, unknown>> | undefined;
      const previousById = new Map(existingModels?.map((model) => [model.id, model]) ?? []);
      document.providers[id] = {
        ...document.providers[id],
        name: record.name,
        baseUrl: local && !root.endsWith('/v1') ? `${root}/v1` : root,
        api: record.api ?? 'openai-completions',
        ...(local
          ? { apiKey: id, compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }
          : {}),
        models: models.map((model) => ({
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          ...(previousById.get(model.id) ?? {
            reasoning: false,
            input: ['text'],
          }),
          id: model.id,
          name: model.name ?? (local ? `${model.id} (Local)` : model.id),
        })),
      };
      const marked = document.octopusModelCapabilities?.[id];
      if (discoveredModels && marked && document.octopusModelCapabilities) {
        const discoveredIds = new Set(discoveredModels.map((model) => model.id));
        const remaining = Object.fromEntries(
          Object.entries(marked).filter(([modelId]) => discoveredIds.has(modelId))
        );
        if (Object.keys(remaining).length > 0) {
          document.octopusModelCapabilities[id] = remaining;
        } else {
          delete document.octopusModelCapabilities[id];
        }
      }
    }
  });
}

/**
 * Removes one Settings-owned provider and its draft without touching unrelated Pi configuration.
 */
export async function deleteCustomProvider(path: string, id: string): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    if (document.octopusLocalProviders) {
      delete document.octopusLocalProviders[id];
    }
    if (document.octopusModelCapabilities) {
      delete document.octopusModelCapabilities[id];
    }
    delete document.providers[id];
  });
}

/**
 * Updates Pi capabilities and preserves Host interface declarations separately from inference settings.
 */
export async function saveModelCapabilities(
  path: string,
  id: string,
  modelId: string,
  input: UpdateModelCapabilitiesBody
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    const { imageGeneration, interfaces, ...piCapabilities } = input;
    const provider = document.providers[id];
    if (!provider) {
      throw new Error('Provider configuration no longer exists.');
    }
    const models = provider.models as Array<Record<string, unknown>> | undefined;
    const model = models?.find((candidate) => candidate.id === modelId);
    if (model) {
      Object.assign(model, piCapabilities);
      if (document.octopusLocalProviders?.[id]) {
        model.compat = { ...(model.compat as object), supportsReasoningEffort: input.reasoning };
      }
    }
    document.octopusModelCapabilities ??= {};
    const marked = { ...document.octopusModelCapabilities[id] };
    marked[modelId] = {
      ...marked[modelId],
      imageGeneration,
      ...(interfaces === undefined ? {} : { interfaces }),
    };
    if (Object.keys(marked).length > 0) {
      document.octopusModelCapabilities[id] = marked;
    } else {
      delete document.octopusModelCapabilities[id];
    }
    const overrides = (provider.modelOverrides ?? {}) as Record<string, object>;
    if (!model || overrides[modelId]) {
      provider.modelOverrides = { ...overrides, [modelId]: { ...overrides[modelId], ...piCapabilities } };
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
