/**
 * @author Codex
 * @description Persists user-added provider metadata and Pi model configuration in one atomic document.
 */
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adaptRelayModel, readBuiltinModelCatalog } from './model-adaptation.js';
import type {
  ModelAssociation,
  CustomProviderConfigurationDto,
  ModelAdaptation,
} from '@octopus/shared/protocol';

export interface CustomProviderRecord extends CustomProviderConfigurationDto {
  name: string;
}
export interface RelayModelRecord {
  id: string;
  name?: string;
  adaptation: ModelAdaptation;
  source?: ModelAssociation;
}
interface ModelDocument {
  octopusRelayModels?: Record<string, RelayModelRecord[]>;
  providers: Record<string, Record<string, unknown>>;
  /** Persisted Pi document key used by existing installations. */
  octopusLocalProviders?: Record<string, CustomProviderRecord>;
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
  return {
    records,
    relayModels: document.octopusRelayModels ?? {},
  };
}

/**
 * Reads provider records for mutation paths that do not need model capabilities.
 */
export async function readCustomProviders(path: string): Promise<Record<string, CustomProviderRecord>> {
  return (await readCustomProviderMetadata(path)).records;
}

/**
 * Persists discovered models and retained source associations.
 * @returns Whether the persisted Pi Provider configuration changed; metadata-only drafts return false.
 */
export async function saveCustomProvider(
  path: string,
  id: string,
  record: CustomProviderRecord,
  discoveredModels?: ReadonlyArray<{ id: string; name?: string }>
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    applyCustomProvider(document, id, record, discoveredModels);
  });
}

/**
 * Merges discovered models into the latest locked document, preserving source associations and local definitions.
 */
function applyCustomProvider(
  document: ModelDocument,
  id: string,
  record: CustomProviderRecord,
  discoveredModels?: ReadonlyArray<{ id: string; name?: string }>
): void {
  document.octopusLocalProviders = {
    ...document.octopusLocalProviders,
    [id]:
      record.runtime === 'mr-token'
        ? { name: record.name, runtime: record.runtime, baseUrl: record.baseUrl }
        : record,
  };
  const models = discoveredModels;
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
      ...(record.runtime !== 'mr-token'
        ? {
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
              ...(document.providers[id]?.compat as object),
            },
          }
        : {}),
      ...(local ? { apiKey: id } : {}),
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
    if (record.runtime === 'mr-token') {
      const catalog = readBuiltinModelCatalog();
      const previous = new Map(document.octopusRelayModels?.[id]?.map((model) => [model.id, model]));
      const definitions: Record<string, unknown>[] = [];
      const relayModels = models.map((model): RelayModelRecord => {
        const source = previous.get(model.id)?.source;
        const adapted = adaptRelayModel(model.id, catalog, source);
        const previousModel = previousById.get(model.id);
        if (adapted.definition) {
          definitions.push({
            ...adapted.definition,
            id: model.id,
            name: model.name ?? model.id,
            cost: previousModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          });
        }
        return { ...model, adaptation: adapted.adaptation, ...(source ? { source } : {}) };
      });
      document.octopusRelayModels ??= {};
      document.octopusRelayModels[id] = relayModels;
      document.providers[id].models = definitions;
      // Relay request parameters belong to the associated Pi model, never to a provider overlay.
      delete document.providers[id].api;
      delete document.providers[id].compat;
      delete document.providers[id].modelOverrides;
    }
  }
}

/**
 * Removes one Settings-owned provider and its draft without touching unrelated Pi configuration.
 */
export async function deleteCustomProvider(path: string, id: string): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    if (document.octopusLocalProviders) {
      delete document.octopusLocalProviders[id];
    }
    if (document.octopusRelayModels) {
      delete document.octopusRelayModels[id];
    }
    delete document.providers[id];
  });
}

/**
 * Corrects one relay association or restores automatic matching under the document write lock.
 */
export async function saveModelAssociation(
  path: string,
  id: string,
  modelId: string,
  source: ModelAssociation | null
): Promise<boolean> {
  return updateProviderDocument(path, id, (document) => {
    const record = document.octopusLocalProviders?.[id];
    const entries = document.octopusRelayModels?.[id];
    const entry = entries?.find((model) => model.id === modelId);
    if (record?.runtime !== 'mr-token' || !entry || !entries) {
      throw new Error('Relay model no longer exists.');
    }
    if (
      source &&
      adaptRelayModel(modelId, readBuiltinModelCatalog(), source).adaptation.status !== 'adapted'
    ) {
      throw new Error('The selected Pi model is incompatible with this provider.');
    }
    if (source) {
      entry.source = source;
    } else {
      delete entry.source;
    }
    applyCustomProvider(
      document,
      id,
      record,
      entries.map(({ id, name }) => ({ id, name }))
    );
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
    const previousDocument = JSON.stringify(document);
    update(document);
    if (previousDocument === JSON.stringify(document)) {
      return false;
    }
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

/**
 * Reconciles persisted relay definitions during startup or explicit catalog refresh, without network calls.
 * Unadapted discoveries remain in Host metadata but never enter Pi's executable model catalog.
 */
export async function reconcileRelayModels(path: string): Promise<void> {
  const metadata = await readCustomProviderMetadata(path);
  for (const id of Object.keys(metadata.records)) {
    if (metadata.records[id]?.runtime !== 'mr-token') {
      continue;
    }
    await updateProviderDocument(path, id, (document) => {
      const record = document.octopusLocalProviders?.[id];
      if (record?.runtime !== 'mr-token') {
        return;
      }
      const models = document.octopusRelayModels?.[id];
      if (models) {
        applyCustomProvider(
          document,
          id,
          record,
          models.map(({ id, name }) => ({ id, ...(name ? { name } : {}) }))
        );
      }
    });
  }
}
