/**
 * @author Codex
 * @description Reads PDF image resource dimensions without decoding large raster payloads during scan assessment.
 */
import { createRequire } from 'node:module';
import type * as PdfLib from '@cantoo/pdf-lib';
import type { PDFDict } from '@cantoo/pdf-lib';

const {
  PDFDocument,
  PDFDict: Dictionary,
  PDFName,
  PDFNumber,
  PDFStream,
} = createRequire(import.meta.url)('@cantoo/pdf-lib') as typeof PdfLib;

/**
 * Returns page-level large-raster evidence; resource presence is a heuristic, not proof of visible coverage.
 * Unknown/malformed resource trees return null rather than claiming the page is text-only.
 */
export async function inspectPdfPageImages(bytes: Uint8Array): Promise<Array<boolean | null>> {
  try {
    const pdf = await PDFDocument.load(bytes, { password: '', updateMetadata: false });
    return pdf.getPages().map((page) => {
      try {
        return hasLargeImage(page.node.Resources());
      } catch {
        return null;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Traverses bounded nested Form resource dictionaries, following references through their owning context.
 */
function hasLargeImage(resources: PDFDict | undefined): boolean {
  const pending = resources ? [resources] : [];
  const visited = new Set<PDFDict>();
  while (pending.length > 0) {
    const resource = pending.pop()!;
    if (visited.has(resource)) {
      continue;
    }
    visited.add(resource);
    if (visited.size > 2_000) {
      throw new Error('PDF image resource limit exceeded.');
    }
    const objects = resource.lookupMaybe(PDFName.of('XObject'), Dictionary);
    for (const [, reference] of objects?.entries() ?? []) {
      const object = resource.context.lookup(reference);
      if (!(object instanceof PDFStream)) {
        continue;
      }
      const subtype = object.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
      if (subtype === 'Image') {
        const width = object.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0;
        const height = object.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0;
        if (width * height >= 1_000_000 && Math.min(width, height) >= 500) {
          return true;
        }
      } else if (subtype === 'Form') {
        const nested = object.dict.lookupMaybe(PDFName.of('Resources'), Dictionary);
        if (nested) {
          pending.push(nested);
        }
      }
    }
  }
  return false;
}
