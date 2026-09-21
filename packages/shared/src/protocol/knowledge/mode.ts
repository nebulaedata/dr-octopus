/**
 * @author Codex
 * @description Serializable Agent-owned knowledge mode configuration and validated Host projection.
 */
export interface KnowledgeModeConfig {
  collectionIds: string[];
}

export interface KnowledgeModeState extends KnowledgeModeConfig {
  version: 1;
  enabled: boolean;
}

/**
 * Validate collection scope; the Session exclusively owns model selection.
 */
export function parseKnowledgeModeConfig(value: unknown): KnowledgeModeConfig {
  const data = value as Partial<KnowledgeModeConfig> | null;
  if (
    !data ||
    !Array.isArray(data.collectionIds) ||
    data.collectionIds.length > 20 ||
    data.collectionIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) ||
    new Set(data.collectionIds).size !== data.collectionIds.length
  ) {
    throw new Error('知识问答配置无效：最多选择 20 个集合，集合 ID 必须有效且不重复');
  }
  return { collectionIds: [...data.collectionIds] };
}

/**
 * Project only public versioned state; never expose saved tools or restoration internals to a Host.
 */
export function parseKnowledgeModeState(value: unknown): KnowledgeModeState | undefined {
  try {
    const data = value as KnowledgeModeState;
    if (data.version !== 1 || typeof data.enabled !== 'boolean') {
      return undefined;
    }
    return {
      version: 1,
      enabled: data.enabled,
      ...parseKnowledgeModeConfig(data),
    };
  } catch {
    return undefined;
  }
}
