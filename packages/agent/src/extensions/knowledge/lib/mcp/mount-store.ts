/**
 * @author Codex
 * @description Atomic remote catalogs and opaque citation references with no copied credentials or vectors.
 */
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { mounts, remoteCitations } from '../../db/schema.js';
import { KnowledgeError } from '../../definitions/error.js';
import { globalKnowledgeConnections, resolveKnowledgeConnection } from './global-connections.js';
import { RemoteKnowledgeClient } from './remote-client.js';
import type { KnowledgeDatabase } from '../../db/database.js';
import type {
  IndexedChunk,
  KnowledgeCollection,
  KnowledgeHit,
  KnowledgeMount,
  RemoteCollection,
} from '@octopus/shared/protocol/knowledge';

/**
 * Namespace remote collection identities without exposing endpoint URLs or relying on display names.
 */
export function remoteCollectionRef(mountId: string, collectionId: string): string {
  return (
    'remote_' +
    createHash('sha256')
      .update(mountId + '\0' + collectionId)
      .digest('hex')
  );
}

/**
 * Project cached catalogs into read-only global rows, sorted behind local creations for stable page arithmetic.
 */
export function remoteCollections(database: KnowledgeDatabase): KnowledgeCollection[] {
  return database.db
    .select()
    .from(mounts)
    .all()
    .flatMap((mount) =>
      mount.catalog.map((item) => ({
        id: remoteCollectionRef(mount.id, item.id),
        scope: { kind: 'global' as const },
        name: item.name,
        description: item.description,
        source: 'remote' as const,
        mountId: mount.id,
        connectionRef: mount.connectionRef,
        remoteState: mount.enabled && !mount.error ? ('ready' as const) : ('unavailable' as const),
        revision: 1,
        published: false,
        activeGenerationId: null,
        rebuildJobId: null,
        createdAt: '1970-01-01T00:00:00.000Z',
        deletedAt: null,
      }))
    )
    .sort((a, b) => b.id.localeCompare(a.id));
}

export class KnowledgeMountStore {
  private readonly retryAfter = new Map<string, number>();
  private readonly refreshing = new Set<string>();

  /**
   * Refresh stale directory pages on demand with a shared five-second budget and bounded parallelism.
   */
  async refreshStale(signal?: AbortSignal): Promise<void> {
    const deadline = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    const stale = this.list()
      .filter(
        (item) =>
          item.enabled &&
          !this.refreshing.has(item.id) &&
          Date.now() >= (this.retryAfter.get(item.id) ?? 0) &&
          (!item.lastSuccessAt || Date.parse(item.lastSuccessAt) < Date.now() - 60_000)
      )
      .slice(0, 4);
    await Promise.allSettled(
      stale.map(async (item) => {
        this.refreshing.add(item.id);
        try {
          await this.refresh(item.id, deadline);
        } finally {
          this.refreshing.delete(item.id);
        }
      })
    );
  }
  /**
   * Keep remote ownership and authentication behind one independently testable adapter.
   */
  constructor(
    private readonly database: KnowledgeDatabase,
    private readonly agentDir: string,
    private readonly instanceId: string
  ) {}

  /**
   * Expose connection names without leaking URL credentials or tokens.
   */
  connections() {
    return Object.keys(globalKnowledgeConnections(this.agentDir)).map((name) => {
      try {
        resolveKnowledgeConnection(this.agentDir, name);
        return { name, available: true };
      } catch {
        return { name, available: false };
      }
    });
  }

  /**
   * Read the last complete catalogs; failed refreshes never erase them.
   */
  list(): KnowledgeMount[] {
    return this.database.db.select().from(mounts).all();
  }

  /**
   * Require a currently mounted collection before any remote read or query.
   */
  resolve(collectionRef: string): { mount: KnowledgeMount; collection: RemoteCollection } {
    for (const mount of this.list()) {
      const collection = mount.catalog.find(
        (item) => remoteCollectionRef(mount.id, item.id) === collectionRef
      );
      if (collection && mount.enabled) {
        return { mount, collection };
      }
    }
    throw new KnowledgeError('NOT_FOUND', '远程集合已移除');
  }

  /**
   * Validate the complete remote catalog before inserting a new mount; duplicate/self instances are refused.
   */
  async create(connectionRef: string, signal?: AbortSignal): Promise<KnowledgeMount> {
    if (this.list().length >= 20) {
      throw new KnowledgeError('CAPACITY', '最多挂载 20 个知识库实例');
    }
    const result = await this.withClient(
      connectionRef,
      undefined,
      30_000,
      signal,
      async (client, instanceId) => ({ instanceId, catalog: await this.catalog(client) })
    );
    if (this.list().some((item) => item.instanceId === result.instanceId)) {
      throw new KnowledgeError('REVISION_CONFLICT', '该知识库实例已经挂载');
    }
    const item: KnowledgeMount = {
      id: randomUUID(),
      connectionRef,
      instanceId: result.instanceId,
      enabled: true,
      catalog: result.catalog,
      lastSuccessAt: new Date().toISOString(),
      error: null,
    };
    this.database.db.insert(mounts).values(item).run();
    return item;
  }

  /**
   * Swap only a complete catalog; preserve previous rows and an explicit stale diagnosis on failure.
   */
  async refresh(id: string, signal?: AbortSignal): Promise<KnowledgeMount> {
    const previous = this.list().find((item) => item.id === id);
    if (!previous) {
      throw new KnowledgeError('NOT_FOUND', '挂载不存在');
    }
    try {
      const catalog = await this.withClient(
        previous.connectionRef,
        previous.instanceId,
        30_000,
        signal,
        (client) => this.catalog(client)
      );
      this.database.db
        .update(mounts)
        .set({ catalog, error: null, lastSuccessAt: new Date().toISOString() })
        .where(eq(mounts.id, id))
        .run();
      this.retryAfter.delete(id);
    } catch (error) {
      this.retryAfter.set(id, Date.now() + 30_000);
      this.database.db
        .update(mounts)
        .set({ error: safeRemoteCode(error) })
        .where(eq(mounts.id, id))
        .run();
      throw new KnowledgeError(safeRemoteCode(error), '远程目录刷新失败，保留上次完整目录', true);
    }
    const current = this.list().find((item) => item.id === id);
    if (!current) {
      throw new KnowledgeError('NOT_FOUND', '挂载已移除');
    }
    return current;
  }

  /**
   * Revoke local references; cascaded citation deletion never touches the remote instance.
   */
  remove(id: string): void {
    this.retryAfter.delete(id);
    this.database.db.delete(mounts).where(eq(mounts.id, id)).run();
  }

  /**
   * Query one source with a bounded deadline and mint local read references only after rechecking the mount.
   */
  async search(
    mount: KnowledgeMount,
    collectionRefs: string[],
    query: string,
    limit: number,
    signal?: AbortSignal
  ) {
    if (Date.now() < (this.retryAfter.get(mount.id) ?? 0)) {
      throw new KnowledgeError('REMOTE_UNAVAILABLE', '远程连接正在短暂退避，请稍后重试或刷新连接', true);
    }
    const ids = collectionRefs.map((ref) => this.resolve(ref).collection.id);
    try {
      const response = await this.withClient(mount.connectionRef, mount.instanceId, 5000, signal, (client) =>
        client.call('knowledge_search', { collectionIds: ids, query, topK: limit })
      );
      this.database.db.update(mounts).set({ error: null }).where(eq(mounts.id, mount.id)).run();
      const hits: KnowledgeHit[] = response.hits.map((hit) => {
        const collectionRef = remoteCollectionRef(mount.id, hit.collectionId);
        if (!collectionRefs.includes(collectionRef)) {
          throw new KnowledgeError('INCOMPATIBLE', '远端返回了范围外的集合');
        }
        this.resolve(collectionRef);
        const citationId = 'remote_' + randomUUID();
        this.database.db
          .insert(remoteCitations)
          .values({
            id: citationId,
            mountId: mount.id,
            collectionId: hit.collectionId,
            remoteReadRef: hit.remoteReadRef,
            expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
          })
          .run();
        return {
          ...hit,
          collectionId: collectionRef,
          collectionRef,
          citationId,
          chunkId: mount.id + ':' + hit.chunkId,
          generationId: mount.instanceId,
          indexRevision: hit.documentVersionId,
          extractionMethod: 'text',
          ordinal: 0,
        };
      });
      return {
        hits,
        coverage: response.coverage,
        warnings: response.warnings,
        sources: collectionRefs.map((collectionRef, i) => ({
          collectionRef,
          state:
            response.sources.find((item) => item.collectionRef === ids[i])?.state ?? ('unavailable' as const),
        })),
      };
    } catch (error) {
      this.retryAfter.set(mount.id, Date.now() + 30_000);
      this.database.db
        .update(mounts)
        .set({ error: safeRemoteCode(error) })
        .where(eq(mounts.id, mount.id))
        .run();
      throw new KnowledgeError(safeRemoteCode(error), '远程知识库暂不可用', true);
    }
  }

  /**
   * Read the remote immutable reference and validate source ownership again after network completion.
   */
  async read(id: string, signal?: AbortSignal): Promise<IndexedChunk> {
    const reference = this.database.db.select().from(remoteCitations).where(eq(remoteCitations.id, id)).get();
    if (!reference || Date.parse(reference.expiresAt) <= Date.now()) {
      throw new KnowledgeError('EVIDENCE_GONE', '远端引用已失效');
    }
    const collectionRef = remoteCollectionRef(reference.mountId, reference.collectionId);
    const { mount } = this.resolve(collectionRef);
    const value = await this.withClient(mount.connectionRef, mount.instanceId, 5000, signal, (client) =>
      client.call('knowledge_read', { readRef: reference.remoteReadRef, maxChars: 8000 })
    );
    this.resolve(collectionRef);
    if (value.collectionId !== reference.collectionId) {
      throw new KnowledgeError('INCOMPATIBLE', '远端引用范围不匹配');
    }
    return {
      ...value,
      collectionId: collectionRef,
      chunkId: mount.id + ':' + value.chunkId,
      indexRevision: value.documentVersionId,
      ordinal: 0,
      extractionMethod: 'text',
    };
  }

  /**
   * Fetch every bounded page at one revision; partial refresh results are never persisted.
   */
  private async catalog(client: RemoteKnowledgeClient): Promise<RemoteCollection[]> {
    const items: RemoteCollection[] = [];
    let cursor: string | undefined;
    let revision: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.call('knowledge_list_collections', { cursor, limit: 100 });
      if (revision && revision !== page.catalogRevision) {
        throw new KnowledgeError('REVISION_EXPIRED', '远程目录已变更，请重试');
      }
      revision = page.catalogRevision;
      items.push(...page.items);
      if (items.length > 2000 || new Set(items.map((item) => item.id)).size !== items.length) {
        throw new KnowledgeError('INCOMPATIBLE', '远程目录过大或重复');
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor && cursors.has(cursor)) {
        throw new KnowledgeError('INCOMPATIBLE', '远程目录游标循环');
      }
      if (cursor) {
        cursors.add(cursor);
      }
    } while (cursor);
    return items;
  }

  /**
   * Resolve credentials on every use and close the connection even when negotiation or parsing fails.
   */
  private async withClient<T>(
    name: string,
    expectedInstance: string | undefined,
    timeout: number,
    signal: AbortSignal | undefined,
    action: (client: RemoteKnowledgeClient, instanceId: string) => Promise<T>
  ): Promise<T> {
    const connection = resolveKnowledgeConnection(this.agentDir, name);
    const deadline = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    const client = new RemoteKnowledgeClient(connection, deadline);
    try {
      await client.connect();
      const description = await client.call('knowledge_describe', {});
      if (
        description.instanceId === this.instanceId ||
        (expectedInstance && expectedInstance !== description.instanceId)
      ) {
        throw new KnowledgeError('INCOMPATIBLE', '不能挂载本实例或替换为另一远程实例');
      }
      const value = await action(client, description.instanceId);
      if (JSON.stringify(connection) !== JSON.stringify(resolveKnowledgeConnection(this.agentDir, name))) {
        throw new KnowledgeError('AUTH_REQUIRED', 'MCP 连接配置已变更，请重试');
      }
      return value;
    } finally {
      await client.close();
    }
  }
}

/**
 * Keep provider diagnostics, response bodies and credentials outside persisted mount status.
 */
function safeRemoteCode(error: unknown): string {
  return error instanceof KnowledgeError ? error.code : 'UNAVAILABLE';
}
