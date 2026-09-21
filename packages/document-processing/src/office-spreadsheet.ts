/**
 * @author Codex
 * @description Extracts worksheet rows using a disk-backed shared-string index without creating a workbook object graph.
 */
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attributes, nodes, relationshipTarget, xmlEvents } from './office-container.js';
import { DocumentProcessingError } from './types.js';
import { dateText, spreadsheetDates } from './spreadsheet-dates.js';
import type { SpreadsheetDates } from './spreadsheet-dates.js';
import type { FileHandle } from 'node:fs/promises';
import type { OfficeContainer } from './office-container.js';
import type { ParsedSection } from './types.js';

/**
 * Store strings and fixed-width offsets on disk; each lookup allocates at most one bounded cell value.
 */
class SharedStrings {
  private count = 0;
  private offset = 0;
  /**
   * Use handles owned by the enclosing parse lifetime.
   */
  constructor(
    private readonly values: FileHandle,
    private readonly index: FileHandle
  ) {}
  /**
   * Append one rich/plain shared string without retaining an in-memory lookup table.
   */
  async add(text: string): Promise<void> {
    if (++this.count > 2_000_000) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', '共享字符串数量超过限制');
    }
    const bytes = Buffer.from(text);
    const record = Buffer.alloc(12);
    record.writeDoubleLE(this.offset, 0);
    record.writeUInt32LE(bytes.length, 8);
    await this.values.writeFile(bytes);
    await this.index.writeFile(record);
    this.offset += bytes.length;
  }
  /**
   * Resolve a validated shared-string index, rejecting missing cached data rather than returning an empty cell.
   */
  async get(value: string): Promise<string> {
    const id = Number(value);
    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(id) || id >= this.count) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '共享字符串引用无效');
    }
    const record = Buffer.alloc(12);
    if ((await this.index.read(record, 0, 12, id * 12)).bytesRead !== 12) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '共享字符串索引不完整');
    }
    const bytes = Buffer.alloc(record.readUInt32LE(8));
    if ((await this.values.read(bytes, 0, bytes.length, record.readDoubleLE(0))).bytesRead !== bytes.length) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '共享字符串内容不完整');
    }
    return bytes.toString('utf8');
  }
}

/**
 * Bound cell and row text before a consumer can accumulate it.
 */
function append(text: string, value: string): string {
  if (text.length + value.length > 1_048_576) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '表格单元格或行文本超过限制');
  }
  return text + value;
}

/**
 * Populate disk storage from streamed rich text while omitting phonetic annotations.
 */
async function loadStrings(
  container: OfficeContainer,
  part: string | undefined,
  strings: SharedStrings
): Promise<void> {
  if (!part) {
    return;
  }
  let text = '';
  let visible = false;
  let phonetic = false;
  for await (const event of xmlEvents(container, part)) {
    if (event.type === 'text') {
      if (visible && !phonetic) {
        text = append(text, event.text);
      }
    } else if (event.type === 'open') {
      if (event.tag.local === 'rPh') {
        phonetic = true;
      }
      if (event.tag.local === 't') {
        visible = true;
      }
    } else {
      if (event.tag.local === 'rPh') {
        phonetic = false;
      }
      if (event.tag.local === 't') {
        visible = false;
      }
      if (event.tag.local === 'si') {
        await strings.add(text);
        text = '';
      }
    }
  }
}

/**
 * Parse sparse cells and cached formula results row by row, retaining first-row headings only.
 */
async function* rows(
  container: OfficeContainer,
  part: string,
  sheet: string,
  strings: SharedStrings,
  budget: { cells: number },
  dates: SpreadsheetDates
): AsyncGenerator<ParsedSection> {
  const headings = new Map<string, string>();
  let row = 0;
  let rowText = '';
  let value = '';
  let column = '';
  let type = '';
  let style = 0;
  let columnNumber = 0;
  let visible = false;
  let cell = false;
  let headingSize = 0;
  for await (const event of xmlEvents(container, part)) {
    if (event.type === 'text') {
      if (visible && cell) {
        value = append(value, event.text);
      }
      continue;
    }
    const name = event.tag.local;
    if (event.type === 'open') {
      const attrs = attributes(event.tag);
      if (name === 'row') {
        columnNumber = 0;
        row = attrs.r ? Number(attrs.r) : row + 1;
        if (!Number.isSafeInteger(row) || row < 1 || row > 1_048_576) {
          throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '工作表行号无效');
        }
      }
      if (name === 'c') {
        if (++budget.cells > 2_000_000) {
          throw new DocumentProcessingError('DOCUMENT_LIMIT', '表格单元格数量超过限制');
        }
        if (attrs.r) {
          const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(attrs.r);
          const nextColumn = match
            ? [...match[1]!].reduce((number, char) => number * 26 + char.charCodeAt(0) - 64, 0)
            : 0;
          if (!match || Number(match[2]) !== row || nextColumn <= columnNumber || nextColumn > 16_384) {
            throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '工作表单元格坐标无效');
          }
          column = match[1]!;
          columnNumber = nextColumn;
        } else {
          column = '';
          if (++columnNumber > 16_384) {
            throw new DocumentProcessingError('DOCUMENT_LIMIT', '工作表列数超过限制');
          }
          for (let number = columnNumber; number > 0; number = Math.floor((number - 1) / 26)) {
            column = String.fromCharCode(65 + ((number - 1) % 26)) + column;
          }
        }
        style = Number(attrs.s ?? 0);
        type = attrs.t ?? '';
        value = '';
        cell = true;
      }
      if (name === 'v' || (name === 't' && type === 'inlineStr')) {
        visible = true;
      }
    } else {
      if (name === 'v' || name === 't') {
        visible = false;
      }
      if (name === 'c') {
        const text =
          type === 's'
            ? await strings.get(value)
            : type === 'b'
              ? value === '1'
                ? 'TRUE'
                : 'FALSE'
              : !type || type === 'n'
                ? dateText(value, style, dates)
                : value;
        if (row === 1) {
          headingSize += text.length;
          if (headingSize > 1_048_576) {
            throw new DocumentProcessingError('DOCUMENT_LIMIT', '工作表标题行超过限制');
          }
          headings.set(column, text);
        }
        rowText = append(rowText, `${rowText ? '\t' : ''}${headings.get(column) || column}: ${text}`);
        cell = false;
      }
      if (name === 'row') {
        if (rowText.trim()) {
          yield { text: rowText, locator: { sheet, row }, extractionMethod: 'text', type: 'table' };
        }
        rowText = '';
      }
    }
  }
}

/**
 * Own scratch files for the complete workbook iteration and clean them on failure, cancellation or early return.
 */
export async function* spreadsheetSections(
  container: OfficeContainer,
  temporaryDirectory?: string
): AsyncGenerator<ParsedSection> {
  const directory = await mkdtemp(join(temporaryDirectory ?? tmpdir(), 'octopus-xlsx-'));
  let values: FileHandle | undefined;
  let index: FileHandle | undefined;
  try {
    values = await open(join(directory, 'values'), 'wx+', 0o600);
    index = await open(join(directory, 'index'), 'wx+', 0o600);
    const strings = new SharedStrings(values, index);
    const rels = await nodes(container, 'xl/_rels/workbook.xml.rels', 'Relationship');
    const dates = await spreadsheetDates(container, rels);
    const shared = rels.find((item) => item.Type?.endsWith('/sharedStrings'));
    await loadStrings(
      container,
      shared ? relationshipTarget(container, 'xl/workbook.xml', shared.Target!) : undefined,
      strings
    );
    const sheets = await nodes(container, 'xl/workbook.xml', 'sheet');
    if (sheets.length > 100) {
      throw new DocumentProcessingError('DOCUMENT_LIMIT', '工作表数量超过限制');
    }
    const budget = { cells: 0 };
    for (const sheet of sheets) {
      const relation = rels.find((item) => item.Id === sheet['r:id'] && item.Type?.endsWith('/worksheet'));
      if (!relation || !sheet.name || sheet.name.length > 255) {
        throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '工作表关系无效');
      }
      yield* rows(
        container,
        relationshipTarget(container, 'xl/workbook.xml', relation.Target!),
        sheet.name,
        strings,
        budget,
        dates
      );
    }
  } finally {
    await values?.close();
    await index?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
