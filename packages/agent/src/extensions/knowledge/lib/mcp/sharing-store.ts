/**
 * @author Codex
 * @description Durable, revocable publication policy independent of the HTTP MCP transport.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { collections, sharing } from '../../db/schema.js';
import { KnowledgeError } from '../../definitions/error.js';
import type { KnowledgeDatabase } from '../../db/database.js';
import type { KnowledgeOperations, KnowledgeSharing } from '@octopus/shared/protocol/knowledge';

export class KnowledgeSharingStore {
  /**
   * Initialize a stable anonymous instance identity even while publication is disabled.
   */
  constructor(private readonly database: KnowledgeDatabase) {
    if (!database.db.select().from(sharing).where(eq(sharing.id, 1)).get()) {
      database.db
        .insert(sharing)
        .values({
          id: 1,
          config: {
            revision: 0,
            instanceId: randomUUID(),
            enabled: false,
            collectionIds: [],
            network: 'loopback',
            allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
            allowedOrigins: [],
            tokenExpiresAt: null,
            tokenConfigured: false,
          },
        })
        .run();
    }
  }

  /**
   * Read only public settings; never serialize token hashes to management clients.
   */
  get(): KnowledgeSharing {
    return this.database.db.select().from(sharing).where(eq(sharing.id, 1)).get()!.config;
  }

  /**
   * CAS publication and optionally rotate the one read-only token, shown exactly once.
   */
  save(input: KnowledgeOperations['sharing.save']['input']): KnowledgeOperations['sharing.save']['output'] {
    return this.database.sqlite.transaction(() => {
      const previous = this.get();
      if (input.revision !== previous.revision) {
        throw new KnowledgeError('REVISION_CONFLICT', '发布配置已变更，请刷新');
      }
      if (new Set(input.collectionIds).size !== input.collectionIds.length) {
        throw new KnowledgeError('INVALID_INPUT', '集合重复');
      }
      for (const id of input.collectionIds) {
        const row = this.database.db.select().from(collections).where(eq(collections.id, id)).get();
        if (!row || row.deletedAt || row.scopeKind !== 'global') {
          throw new KnowledgeError('FORBIDDEN', '只能发布本地全局集合');
        }
      }
      const hosts = input.allowedHosts.map((value) => value.trim().toLowerCase());
      if (!hosts.length || hosts.some((value) => !value || /[\s/@?#*]/u.test(value))) {
        throw new KnowledgeError('INVALID_INPUT', '请填写明确的允许主机名');
      }
      for (const origin of input.allowedOrigins) {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          throw new KnowledgeError('INVALID_INPUT', 'Origin 无效');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
          throw new KnowledgeError('INVALID_INPUT', 'Origin 必须为精确来源');
        }
      }
      const token =
        input.rotateToken || (input.enabled && !previous.tokenConfigured)
          ? randomBytes(32).toString('base64url')
          : undefined;
      const next: KnowledgeSharing = {
        ...previous,
        revision: previous.revision + 1,
        enabled: input.enabled,
        collectionIds: input.collectionIds,
        network: input.network,
        allowedHosts: hosts,
        allowedOrigins: input.allowedOrigins,
        tokenConfigured: previous.tokenConfigured || !!token,
        tokenExpiresAt: token ? new Date(Date.now() + 90 * 86400_000).toISOString() : previous.tokenExpiresAt,
      };
      if (
        next.enabled &&
        (!next.collectionIds.length || !next.tokenExpiresAt || Date.parse(next.tokenExpiresAt) <= Date.now())
      ) {
        throw new KnowledgeError('INVALID_INPUT', '启用前请选择集合并生成有效令牌');
      }
      this.database.db
        .update(sharing)
        .set({ config: next, ...(token ? { tokenHash: hash(token) } : {}) })
        .where(eq(sharing.id, 1))
        .run();
      for (const id of input.collectionIds) {
        this.database.db.update(collections).set({ published: true }).where(eq(collections.id, id)).run();
      }
      return { settings: next, ...(token ? { token } : {}) };
    })();
  }

  /**
   * Recheck expiry and token on every inbound operation and again before releasing its result.
   */
  authorize(token: string): KnowledgeSharing {
    const row = this.database.db.select().from(sharing).where(eq(sharing.id, 1)).get()!;
    const equal = timingSafeEqual(
      Buffer.from(hash(token), 'hex'),
      Buffer.from(row.tokenHash ?? hash(''), 'hex')
    );
    if (
      !row.config.enabled ||
      !equal ||
      !row.tokenHash ||
      !row.config.tokenExpiresAt ||
      Date.parse(row.config.tokenExpiresAt) <= Date.now()
    ) {
      throw new KnowledgeError('AUTH_REQUIRED', '知识库共享未启用或令牌已失效');
    }
    const ids = row.config.collectionIds.filter((id) => {
      const item = this.database.db.select().from(collections).where(eq(collections.id, id)).get();
      return item && !item.deletedAt && item.scopeKind === 'global' && item.published;
    });
    return { ...row.config, collectionIds: ids };
  }

  /**
   * Publish a coherent authorized directory snapshot without remote rows or internal storage fields.
   */
  catalog(token: string): KnowledgeOperations['sharing.catalog']['output'] {
    return this.database.sqlite.transaction(() => {
      const settings = this.authorize(token);
      const items = settings.collectionIds
        .map((id) => {
          const row = this.database.db.select().from(collections).where(eq(collections.id, id)).get()!;
          return { id: row.id, name: row.name, description: row.description };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      return { settings, items, revision: hash(JSON.stringify({ revision: settings.revision, items })) };
    })();
  }
}

/**
 * Hash a high-entropy generated bearer token without storing its plaintext.
 */
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
