/**
 * @author Codex
 * @description Collects PDF admission evidence from parsed objects, never from opaque stream bytes or strings.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type * as PdfLib from '@cantoo/pdf-lib';
import type { PDFObject } from '@cantoo/pdf-lib';

// The package's Node-compatible CommonJS export handles its bundled JSON resources.
const { PDFArray, PDFDict, PDFDocument, PDFInvalidObject, PDFName, PDFRef, PDFStream } = createRequire(
  import.meta.url
)('@cantoo/pdf-lib') as typeof PdfLib;

const ACTIVE_NAMES = new Set(['JavaScript', 'JS', 'OpenAction', 'AA', 'Launch']);
const EMBEDDED_NAMES = new Set(['EmbeddedFile', 'Filespec', 'RichMedia']);
const MAX_OBJECTS = 200_000;

/**
 * Resolves compressed objects and escaped names while preserving conservative admission policy.
 * Invalid, password-protected, or excessively complex PDFs return invalid container evidence, never a clean bill.
 * Stream dictionaries are inspected, but their binary payloads are deliberately excluded.
 */
export async function inspectPdfObjects(path: string): Promise<{
  valid: boolean;
  pageCount: number;
  hasActiveContent: boolean;
  hasEmbeddedObject: boolean;
}> {
  const bytes = await readFile(path);
  try {
    const pdf = await PDFDocument.load(bytes, { password: '', updateMetadata: false });
    // Follow the live catalog graph: obsolete incremental-update objects and xref streams
    // are not document actions. Any invalid object reachable from the catalog fails closed.
    const pending: PDFObject[] = [pdf.catalog];
    const visited = new Set<PDFObject>();
    let hasActiveContent = false;
    let hasEmbeddedObject = false;
    while (pending.length > 0) {
      const object = pending.pop()!;
      if (visited.has(object)) {
        continue;
      }
      visited.add(object);
      if (visited.size > MAX_OBJECTS) {
        throw new Error('PDF preflight object limit exceeded.');
      }
      if (object instanceof PDFInvalidObject) {
        throw new Error('Invalid PDF object in the document graph.');
      } else if (object instanceof PDFRef) {
        const resolved = pdf.context.lookup(object);
        if (resolved === undefined) {
          throw new Error('Unresolved PDF object in the document graph.');
        }
        pending.push(resolved);
      } else if (object instanceof PDFName) {
        const name = object.decodeText();
        hasActiveContent ||= ACTIVE_NAMES.has(name);
        hasEmbeddedObject ||= EMBEDDED_NAMES.has(name);
      } else if (object instanceof PDFStream) {
        pending.push(object.dict);
      } else if (object instanceof PDFDict) {
        for (const [key, value] of object.entries()) {
          pending.push(key, value);
        }
      } else if (object instanceof PDFArray) {
        for (const value of object.asArray()) {
          pending.push(value);
        }
      }
    }
    return { valid: true, pageCount: pdf.getPageCount(), hasActiveContent, hasEmbeddedObject };
  } catch {
    return { valid: false, pageCount: 0, hasActiveContent: false, hasEmbeddedObject: false };
  }
}
