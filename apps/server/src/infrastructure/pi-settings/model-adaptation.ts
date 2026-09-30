/**
 * @author Codex
 * @description Resolves transparent relay models against Pi's public native-provider catalog without implementing request conversion.
 */
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import { hasApi } from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelAdaptation, ModelAssociation, ModelAssociationCandidate } from '@octopus/shared/protocol';

// These are catalog ownership hints, never protocol parameter defaults or model aliases.
const origins: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/^qwen/i, ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual']],
  [/^deepseek/i, ['deepseek']],
  [/^kimi|^moonshot/i, ['moonshotai', 'moonshotai-cn']],
  [/^minimax/i, ['minimax', 'minimax-cn']],
  [/^(gpt-|o[134](?:-|$)|chatgpt-)/i, ['openai']],
  [/^claude/i, ['anthropic']],
  [/^gemini/i, ['google']],
  [/^glm/i, ['zai', 'zai-coding-cn']],
  [/^grok/i, ['xai']],
  [/^mimo/i, ['xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp']],
  [/^(mistral|ministral|magistral|codestral|devstral|pixtral|voxtral)/i, ['mistral']],
  [/^(ling|ring)/i, ['ant-ling']],
];

export interface AdaptedModel {
  adaptation: ModelAdaptation;
  definition?: Record<string, unknown>;
}

/**
 * Reads immutable built-in definitions without credentials, runtime overlays or network discovery.
 */
export function readBuiltinModelCatalog(): Model<Api>[] {
  return getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider));
}

/**
 * Requires exact IDs and native ownership; equivalent regional entries share one deterministic source.
 * Unknown IDs and conflicting templates remain unavailable. Each source owns its API protocol.
 */
export function adaptRelayModel(
  id: string,
  catalog: readonly Model<Api>[],
  association?: ModelAssociation
): AdaptedModel {
  const targetId = association?.modelId ?? id;
  const nativeProviders = origins.find(([pattern]) => pattern.test(targetId))?.[1];
  const candidates = catalog.filter(
    (model) =>
      model.id === targetId &&
      nativeProviders?.includes(model.provider) &&
      (!association || model.provider === association.providerId)
  );
  if (candidates.length === 0) {
    return { adaptation: { status: 'unadapted', reason: 'not_found' } };
  }
  const definitions = candidates.map(templateDefinition);
  if (new Set(definitions.map((definition) => JSON.stringify(definition))).size !== 1) {
    return { adaptation: { status: 'unadapted', reason: 'ambiguous' } };
  }
  const source = candidates[0]!;
  // Completions adapters have provider/URL inference. Accept only explicit native wire contracts;
  // do not reproduce Pi's private detectCompat implementation in the Host.
  if (
    hasApi(source, 'openai-completions') &&
    (source.compat?.supportsDeveloperRole === undefined ||
      source.compat?.supportsStore === undefined ||
      source.compat?.thinkingFormat === undefined)
  ) {
    return { adaptation: { status: 'unadapted', reason: 'incomplete' } };
  }
  return {
    adaptation: {
      status: 'adapted',
      source: { providerId: source.provider, modelId: source.id, api: source.api },
    },
    definition: definitions[0],
  };
}

/**
 * Lists transferable native templates across all supported model protocols.
 */
export function listModelAssociationCandidates(): ModelAssociationCandidate[] {
  const catalog = readBuiltinModelCatalog();
  return catalog.flatMap((model) => {
    const source = { providerId: model.provider, modelId: model.id };
    return adaptRelayModel(model.id, catalog, source).adaptation.status === 'adapted'
      ? [{ ...source, name: model.name, api: model.api }]
      : [];
  });
}

/**
 * Copies Pi's declarative inference contract, excluding source endpoints, authentication and pricing.
 */
function templateDefinition(model: Model<Api>): Record<string, unknown> {
  return {
    api: model.api,
    reasoning: model.reasoning,
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.compat ? { compat: structuredClone(model.compat) } : {}),
    ...(model.thinkingLevelMap ? { thinkingLevelMap: structuredClone(model.thinkingLevelMap) } : {}),
    ...(model.samplingParams ? { samplingParams: structuredClone(model.samplingParams) } : {}),
  };
}
