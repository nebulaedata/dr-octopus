/**
 * @author Codex
 * @description Bounded local/remote retrieval orchestration without remote index replication.
 */
import { randomUUID } from 'node:crypto';
import type {
  KnowledgeContext,
  KnowledgeHit,
  KnowledgeMount,
  KnowledgeSearchResult,
} from '@octopus/shared/protocol/knowledge';
import type { KnowledgeSearchEngine } from '../search-engine.js';
import type { KnowledgeMountStore } from './mount-store.js';

export class FederatedKnowledgeSearch {
  /**
   * Keep local retrieval and remote transport independently owned and independently degradable.
   */
  constructor(
    private readonly local: KnowledgeSearchEngine,
    private readonly mounts: KnowledgeMountStore
  ) {}

  /**
   * Merge rank positions fairly; forward only the selected query and never remote text to a local provider.
   */
  async search(
    context: KnowledgeContext,
    ids: string[],
    query: string,
    limit = 8,
    signal?: AbortSignal
  ): Promise<KnowledgeSearchResult> {
    const locals = ids.filter((id) => !id.startsWith('remote_'));
    const groups = new Map<string, { mount: KnowledgeMount; ids: string[] }>();
    for (const id of ids.filter((item) => item.startsWith('remote_'))) {
      const { mount } = this.mounts.resolve(id);
      const group = groups.get(mount.id) ?? { mount, ids: [] };
      group.ids.push(id);
      groups.set(mount.id, group);
    }
    const localPromise = locals.length
      ? this.local.search(context, locals, query, limit, signal)
      : Promise.resolve<KnowledgeSearchResult>({
          hits: [],
          coverage: 'complete',
          sources: [],
          warnings: [],
          queryId: randomUUID(),
          ranking: { strategy: 'rrf', configRevision: 0, degraded: false },
        });
    const deadline = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    const results: {
      hits: KnowledgeHit[];
      coverage: KnowledgeSearchResult['coverage'];
      sources: KnowledgeSearchResult['sources'];
      warnings: string[];
    }[] = [];
    const entries = [...groups.values()];
    const remotePromise = (async () => {
      for (let start = 0; start < entries.length; start += 4) {
        await Promise.all(
          entries.slice(start, start + 4).map(async (group) => {
            try {
              results.push(await this.mounts.search(group.mount, group.ids, query, limit, deadline));
            } catch {
              results.push({
                hits: [],
                coverage: 'unavailable',
                warnings: ['REMOTE_UNAVAILABLE'],
                sources: group.ids.map((collectionRef) => ({ collectionRef, state: 'unavailable' })),
              });
            }
          })
        );
      }
    })();
    const [local] = await Promise.all([localPromise, remotePromise]);
    signal?.throwIfAborted();
    if (!entries.length) {
      return local;
    }
    const lists = [local.hits, ...results.map((item) => item.hits)];
    const hits = lists
      .flatMap((list) => list.map((hit, rank) => ({ hit, rank })))
      .sort((a, b) => a.rank - b.rank || a.hit.collectionRef.localeCompare(b.hit.collectionRef))
      .slice(0, limit)
      .map((item) => item.hit);
    const sources = [...local.sources, ...results.flatMap((item) => item.sources)];
    const warnings = [...new Set([...local.warnings, ...results.flatMap((item) => item.warnings)])];
    const unavailable = sources.filter((item) => item.state === 'unavailable').length;
    return {
      ...local,
      hits,
      sources,
      warnings,
      coverage:
        unavailable === ids.length
          ? 'unavailable'
          : unavailable ||
              local.coverage === 'partial' ||
              results.some((item) => item.coverage !== 'complete')
            ? 'partial'
            : 'complete',
      ranking: { ...local.ranking, strategy: 'rrf', degraded: warnings.length > 0 },
    };
  }
}
