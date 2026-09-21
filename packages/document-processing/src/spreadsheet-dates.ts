/**
 * @author Codex
 * @description Retains Excel date semantics using bounded style metadata without loading workbook formatting objects.
 */
import { attributes, nodes, relationshipTarget, xmlEvents } from './office-container.js';
import { DocumentProcessingError } from './types.js';
import type { OfficeContainer } from './office-container.js';

export interface SpreadsheetDates {
  date1904: boolean;
  styles: Set<number>;
}

/**
 * Read only date-number formats and cell style indices; other presentation formatting is not materialized.
 */
export async function spreadsheetDates(
  container: OfficeContainer,
  relationships: Record<string, string>[]
): Promise<SpreadsheetDates> {
  const properties = await nodes(container, 'xl/workbook.xml', 'workbookPr');
  const result = {
    date1904: ['1', 'true'].includes(properties[0]?.date1904 ?? ''),
    styles: new Set<number>(),
  };
  const relation = relationships.find((item) => item.Type?.endsWith('/styles'));
  if (!relation) {
    return result;
  }
  const part = relationshipTarget(container, 'xl/workbook.xml', relation.Target!);
  const formats = new Map(
    (await nodes(container, part, 'numFmt')).map((item) => [Number(item.numFmtId), item.formatCode ?? ''])
  );
  let inside = false;
  let index = 0;
  for await (const event of xmlEvents(container, part)) {
    if (event.type === 'text') {
      continue;
    }
    if (event.tag.local === 'cellXfs') {
      inside = event.type === 'open';
    }
    if (inside && event.type === 'open' && event.tag.local === 'xf') {
      if (index >= 10_000) {
        throw new DocumentProcessingError('DOCUMENT_LIMIT', '表格样式数量超过限制');
      }
      const id = Number(attributes(event.tag).numFmtId ?? 0);
      const format = (formats.get(id) ?? '').replace(/\[[^\]]*\]|"[^"]*"|\\./gu, '');
      if (
        (id >= 14 && id <= 22) ||
        (id >= 27 && id <= 36) ||
        (id >= 45 && id <= 47) ||
        (id >= 50 && id <= 58) ||
        /[ymdhs]/iu.test(format)
      ) {
        result.styles.add(index);
      }
      index++;
    }
  }
  return result;
}

/**
 * Convert cached Excel serial dates to timezone-independent ISO text; never evaluate formulas.
 */
export function dateText(value: string, style: number, dates: SpreadsheetDates): string {
  if (!value || !dates.styles.has(style)) {
    return value;
  }
  const serial = Number(value);
  const date = new Date(Math.round((serial - 25569 + (dates.date1904 ? 1462 : 0)) * 86_400_000));
  if (!Number.isFinite(serial) || !Number.isFinite(date.getTime())) {
    throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', '表格日期数值无效');
  }
  return date.toISOString();
}
