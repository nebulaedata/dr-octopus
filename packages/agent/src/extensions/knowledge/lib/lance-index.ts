/**
 * @author Codex
 * @description Generation-isolated Lance storage with active-revision filtering and dictionary-free Chinese FTS.
 */
import { connect, Index } from '@lancedb/lancedb';
import { KnowledgeError } from '../definitions/error.js';
import type { Connection, Table } from '@lancedb/lancedb';
import type { KnowledgeIndex } from '../definitions/port.js';
import type { IndexedChunk, Locator } from '../definitions/types.js';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * Apply the same deterministic word segmentation to documents and queries without external dictionaries.
 */
export function ftsText(text: string): string {
  return [...segmenter.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.toLowerCase())
    .join(' ');
}

/**
 * SQL predicates accept only service-generated UUID/hash identifiers.
 */
function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
    throw new KnowledgeError('INVALID_INPUT', '索引标识无效');
  }
  return `'${value}'`;
}

/**
 * Decode service-owned rows at the native boundary without exposing Arrow internals.
 */
function decode(raw: unknown): IndexedChunk {
  const row = raw as Record<string, unknown>;
  for (const key of [
    'chunkId',
    'documentId',
    'documentVersionId',
    'collectionId',
    'indexRevision',
    'text',
    'locatorJson',
  ]) {
    if (typeof row[key] !== 'string') {
      throw new KnowledgeError('INDEX_UNAVAILABLE', '索引记录损坏');
    }
  }
  return {
    chunkId: String(row.chunkId),
    documentId: String(row.documentId),
    documentVersionId: String(row.documentVersionId),
    collectionId: String(row.collectionId),
    indexRevision: String(row.indexRevision),
    text: String(row.text),
    locator: JSON.parse(String(row.locatorJson)) as Locator,
    extractionMethod: row.extractionMethod === 'ocr' ? 'ocr' : 'text',
    ordinal: Number(row.ordinal),
  };
}

export class LanceKnowledgeIndex implements KnowledgeIndex {
  private readonly tables = new Map<string, Table>();

  /**
   * Retain exactly one connection owned by the knowledge daemon.
   */
  private constructor(private readonly connection: Connection) {}

  /**
   * Load native Lance only when the owning service starts.
   */
  static async open(directory: string): Promise<LanceKnowledgeIndex> {
    return new LanceKnowledgeIndex(await connect(directory));
  }

  /**
   * Persist an unpublished revision; deterministic chunk keys make retries idempotent.
   */
  async write(
    generationId: string,
    chunks: IndexedChunk[],
    vectors: number[][],
    final = true
  ): Promise<void> {
    identifier(generationId);
    if (!chunks.length || chunks.length !== vectors.length) {
      throw new KnowledgeError('INVALID_INPUT', '文档分块为空或向量数量不匹配');
    }
    const data = chunks.map((chunk, index) => ({
      ...chunk,
      locator: undefined,
      locatorJson: JSON.stringify(chunk.locator),
      ftsText: ftsText(chunk.text),
      vector: vectors[index]!,
    }));
    const name = 'g_' + generationId.replaceAll('-', '_');
    let table = this.tables.get(generationId);
    if (!table) {
      const names = await this.connection.tableNames();
      if (names.includes(name)) {
        table = await this.connection.openTable(name);
      } else {
        const first = data[0]!;
        delete first.locator;
        table = await this.connection.createTable(name, [first]);
      }
      this.tables.set(generationId, table);
    }
    for (const row of data) {
      delete row.locator;
    }
    await table.mergeInsert('chunkId').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(data);
    if (final) {
      await table.createIndex('ftsText', {
        config: Index.fts({ baseTokenizer: 'whitespace', stem: false, removeStopWords: false }),
        replace: true,
      });
    }
    const verified = await table.countRows(`indexRevision = ${identifier(chunks[0]!.indexRevision)}`);
    if (verified !== chunks.at(-1)!.ordinal + 1) {
      throw new KnowledgeError('INDEX_INCOMPLETE', '索引写入校验失败');
    }
  }

  /**
   * Filter before top-k so old unpublished chunks cannot hide active document results.
   */
  async search(
    generationId: string,
    revisions: string[],
    query: string,
    vector?: number[]
  ): Promise<IndexedChunk[][]> {
    if (!revisions.length) {
      return [];
    }
    const table = await this.table(generationId);
    const where = `indexRevision IN (${revisions.map(identifier).join(',')})`;
    const lists: IndexedChunk[][] = [];
    if (vector) {
      const values: unknown[] = await table.search(vector).where(where).limit(30).toArray();
      lists.push(values.map(decode));
    }
    const words = ftsText(query);
    if (words) {
      const values: unknown[] = await table
        .search(words, 'fts', ['ftsText'])
        .where(where)
        .limit(30)
        .toArray();
      lists.push(values.map(decode));
    }
    return lists;
  }

  /**
   * Retrieve immutable evidence; the service remains responsible for current scope authorization.
   */
  async read(generationId: string, chunkId: string): Promise<IndexedChunk | null> {
    const values: unknown[] = await (
      await this.table(generationId)
    )
      .query()
      .where(`chunkId = ${identifier(chunkId)}`)
      .limit(1)
      .toArray();
    return values.length ? decode(values[0]) : null;
  }

  /**
   * Remove only an explicitly retired generation.
   */
  async remove(generationId: string): Promise<void> {
    identifier(generationId);
    this.tables.get(generationId)?.close();
    this.tables.delete(generationId);
    const name = 'g_' + generationId.replaceAll('-', '_');
    if ((await this.connection.tableNames()).includes(name)) {
      await this.connection.dropTable(name);
    }
  }

  /**
   * Prune unreachable rows while the application excludes readers and the indexing worker is idle.
   * Retained versions and issued citations remain addressable until their retention expires.
   */
  async prune(
    generationId: string,
    revisions: string[],
    versionIds: string[],
    chunkIds: string[]
  ): Promise<void> {
    if (!(await this.connection.tableNames()).includes('g_' + generationId.replaceAll('-', '_'))) {
      return;
    }
    const keep = [
      ['indexRevision', revisions],
      ['documentVersionId', versionIds],
      ['chunkId', chunkIds],
    ] as const;
    const clauses = keep
      .filter(([, values]) => values.length)
      .map(([column, values]) => `${column} IN (${values.map(identifier).join(',')})`);
    const table = await this.table(generationId);
    await table.delete(clauses.length ? `NOT (${clauses.join(' OR ')})` : 'true');
    await table.optimize({ cleanupOlderThan: new Date(Date.now() - 7 * 86_400_000) });
  }

  /**
   * Release table handles before the connection and singleton lock.
   */
  close(): void {
    for (const table of this.tables.values()) {
      table.close();
    }
    this.tables.clear();
    this.connection.close();
  }

  /**
   * Cache one native table handle per generation within the owning process.
   */
  private async table(id: string): Promise<Table> {
    identifier(id);
    let table = this.tables.get(id);
    if (!table) {
      table = await this.connection.openTable('g_' + id.replaceAll('-', '_'));
      this.tables.set(id, table);
    }
    return table;
  }
}
