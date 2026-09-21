/**
 * @author Codex
 * @description Validates Office packages and exposes bounded XML event streams in logical document order.
 */
import { classifyOfficePart } from './office-part-policy.js';
import { SaxesParser } from 'saxes';
import { posix } from 'node:path';
import { zipDirectory, zipEntryChunks } from './file-zip.js';
import { DocumentProcessingError } from './types.js';
import type { ZipEntry } from './file-zip.js';
import type { SaxesTagNS } from 'saxes';

import type { OfficeCoverageCollector } from './coverage/office.js';

export interface OfficeContainer {
  coverage?: OfficeCoverageCollector;
  path: string;
  entries: Map<string, ZipEntry>;
  signal?: AbortSignal;
}
export type XmlEvent = { type: 'open' | 'close'; tag: SaxesTagNS } | { type: 'text'; text: string };

const HYPERLINK_RELATIONSHIPS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink',
]);

/**
 * Check every entry before producing text, including parts after an attachment's truncation point.
 */
export async function openOffice(
  path: string,
  required: string,
  signal?: AbortSignal
): Promise<OfficeContainer> {
  const entries = new Map((await zipDirectory(path)).map((entry) => [entry.name, entry]));
  const container = { path, entries, signal };
  if (!entries.has(required) || !entries.has('[Content_Types].xml')) {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 容器格式无效');
  }
  const budget = {
    entries: 0,
    expandedBytes: 0,
    maxEntries: 10_000,
    maxExpandedBytes: 512 * 1024 * 1024,
    maxEntryBytes: 100 * 1024 * 1024,
    maxDepth: 1,
  };
  for (const entry of entries.values()) {
    const kind = classifyOfficePart(entry.name);
    if (kind === 'active' || kind === 'unsupported-binary') {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 活动内容或不支持的二进制部件');
    }
    for await (const chunk of zipEntryChunks(path, entry, budget, signal)) {
      // Validation deliberately consumes and discards every inflated chunk.
      void chunk;
    }
    // Embedded payloads are integrity-checked, but never interpreted as package XML.
    if (kind === 'embedded') {
      continue;
    }
    if (entry.name.endsWith('.rels')) {
      for await (const event of xmlEvents(container, entry.name)) {
        if (event.type !== 'open') {
          continue;
        }
        const relationship = attributes(event.tag);
        if (
          /\/(oleObject|package)$/u.test(relationship.Type ?? '') &&
          relationship.TargetMode?.toLowerCase() !== 'external'
        ) {
          const owner = entry.name.replace(/(^|\/)_rels\//u, '$1').replace(/\.rels$/u, '');
          const target = relationshipTarget(container, owner, relationship.Target ?? '');
          if (classifyOfficePart(target) !== 'embedded') {
            throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 嵌入对象位置不受支持');
          }
        }
        // Hyperlinks are inert metadata: readers retain display text without opening their targets.
        if (
          relationship.TargetMode?.toLowerCase() === 'external' &&
          !HYPERLINK_RELATIONSHIPS.has(relationship.Type ?? '')
        ) {
          throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 外部关系不受支持');
        }
      }
    }
  }
  return container;
}

/**
 * Recognize an embedded Equation Editor object by its Office XML contract, independent of namespace prefixes.
 */
export function isLegacyWordEquation(tag: SaxesTagNS): boolean {
  if (tag.uri !== 'urn:schemas-microsoft-com:office:office' || tag.local !== 'OLEObject') {
    return false;
  }
  const attrs = attributes(tag);
  return attrs.Type === 'Embed' && attrs.ProgID === 'Equation.3';
}

/**
 * Decode UTF-8 incrementally and bound both SAX token growth and XML nesting before parsing.
 */
export async function* xmlEvents(container: OfficeContainer, name: string): AsyncGenerator<XmlEvent> {
  if (classifyOfficePart(name) === 'embedded') {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '嵌入对象不能作为外层文档 XML 解析');
  }
  const entry = container.entries.get(name);
  if (!entry) {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office XML 部件缺失');
  }
  const observe = container.coverage?.beginPart(name) ?? false;
  const parser = new SaxesParser({ xmlns: true, position: false });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let events: XmlEvent[] = [];
  let pendingCharacters = 0;
  let depth = 0;
  /**
   * Reset only at completed SAX events, so angle brackets inside comments/CDATA cannot evade the token limit.
   */
  function completed(): void {
    pendingCharacters = 0;
  }
  parser.on('comment', completed);
  parser.on('processinginstruction', completed);
  parser.on('doctype', () => {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '不支持 XML 文档类型');
  });
  parser.on('opentag', (tag) => {
    completed();
    if (++depth > 256) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', 'XML 嵌套超过限制');
    }
    if (observe) {
      container.coverage?.observe(name, tag.local, tag.uri, attributes(tag));
    }
    events.push({ type: 'open', tag });
  });
  parser.on('closetag', (tag) => {
    completed();
    depth--;
    events.push({ type: 'close', tag });
  });
  parser.on('text', (text) => {
    completed();
    events.push({ type: 'text', text });
  });
  parser.on('cdata', (text) => {
    completed();
    events.push({ type: 'text', text });
  });
  for await (const chunk of zipEntryChunks(container.path, entry, undefined, container.signal)) {
    const text = decoder.decode(chunk, { stream: true });
    pendingCharacters += text.length;
    parser.write(text);
    if (pendingCharacters > 1_048_576) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', 'XML 单个标记或文本超过限制');
    }
    yield* events;
    events = [];
  }
  parser.write(decoder.decode()).close();
  yield* events;
  if (observe) {
    container.coverage?.finishPart(name);
  }
}

/**
 * Preserve qualified attribute names for relationship identifiers.
 */
export function attributes(tag: SaxesTagNS): Record<string, string> {
  return Object.fromEntries(
    Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value])
  );
}

/**
 * Collect only bounded package metadata, never document content.
 */
export async function nodes(
  container: OfficeContainer,
  name: string,
  local: string
): Promise<Record<string, string>[]> {
  const result: Record<string, string>[] = [];
  let characters = 0;
  for await (const event of xmlEvents(container, name)) {
    if (event.type === 'open' && event.tag.local === local) {
      if (result.length >= 10_000) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', 'Office 关系数量超过限制');
      }
      const attrs = attributes(event.tag);
      characters += Object.values(attrs).reduce((sum, value) => sum + value.length, 0);
      if (characters > 1_048_576) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', 'Office 关系文本超过限制');
      }
      result.push(attrs);
    }
  }
  return result;
}

/**
 * Resolve internal OPC relationships and require an existing package part.
 */
export function relationshipTarget(container: OfficeContainer, owner: string, target: string): string {
  const name = target.startsWith('/')
    ? posix.normalize(target).slice(1)
    : posix.normalize(posix.join(posix.dirname(owner), target));
  if (!container.entries.has(name) || name.startsWith('../') || name.includes('\\')) {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'Office 部件关系无效');
  }
  return name;
}
