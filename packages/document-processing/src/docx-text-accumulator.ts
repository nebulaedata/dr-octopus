/**
 * @author root
 * @description Converts streamed WordprocessingML events into bounded structured text units for agent context.
 */

import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';
import type { StructuredDocumentV1 } from '@octopus/shared/protocol/attachments';

const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

/**
 * Incrementally extracts visible text from one WordprocessingML part without building a DOM.
 */
export class DocxTextAccumulator {
  private readonly parser = new SaxesParser({ xmlns: true, position: false });
  private readonly units: StructuredDocumentV1['units'] = [];
  private paragraphChunks: string[] = [];
  private rowCells: string[] = [];
  private cellParagraphs: string[] = [];
  private paragraphCharacters = 0;
  private rowCharacters = 0;
  private emittedCharacters = 0;
  private textDepth = 0;
  private excludedDepth = 0;
  private tableDepth = 0;
  private line = 1;
  private truncated = false;

  /**
   * Creates a bounded WordprocessingML consumer.
   *
   * @param maxCharacters Maximum characters emitted across all units.
   * @param maxUnits Maximum structured units emitted from the document.
   */
  public constructor(
    private readonly maxCharacters: number,
    private readonly maxUnits = 100_000
  ) {
    this.parser.on('opentag', (tag) => this.onOpenTag(tag));
    this.parser.on('text', (text) => this.onText(text));
    this.parser.on('closetag', (tag) => this.onCloseTag(tag));
    this.parser.on('doctype', () => {
      throw new Error('WordprocessingML document types are forbidden.');
    });
  }

  /**
   * Feeds one decoded UTF-8 XML fragment to the strict parser.
   *
   * @param chunk XML text that may end between tokens.
   */
  public write(chunk: string): void {
    this.parser.write(chunk);
  }

  /**
   * Closes the parser and returns the bounded structured document.
   */
  public finish(): StructuredDocumentV1 {
    this.parser.close();
    return {
      schemaVersion: 1,
      kind: 'docx',
      units: this.units,
      truncated: this.truncated,
      diagnostics: this.truncated ? ['DOCX_TEXT_TRUNCATED'] : [],
    };
  }

  /**
   * Updates extraction state for a start tag.
   *
   * @param tag Namespace-resolved XML tag.
   */
  private onOpenTag(tag: SaxesTagNS): void {
    if (!isWordTag(tag)) {
      return;
    }
    if (tag.local === 'del' || tag.local === 'moveFrom') {
      this.excludedDepth += 1;
    } else if (tag.local === 'tbl') {
      this.tableDepth += 1;
    } else if (tag.local === 't') {
      this.textDepth += 1;
    } else if (tag.local === 'tab') {
      this.append('\t');
    } else if (tag.local === 'br' || tag.local === 'cr') {
      this.append('\n');
    } else if (tag.local === 'noBreakHyphen') {
      this.append('-');
    } else if (tag.local === 'softHyphen') {
      this.append('\u00ad');
    }
  }

  /**
   * Captures text only while inside a visible Word text run.
   *
   * @param text Decoded XML character data.
   */
  private onText(text: string): void {
    if (this.textDepth > 0 && this.excludedDepth === 0) {
      this.append(text);
    }
  }

  /**
   * Finalizes paragraph, cell, row, and exclusion scopes.
   *
   * @param tag Namespace-resolved XML tag.
   */
  private onCloseTag(tag: SaxesTagNS): void {
    if (!isWordTag(tag)) {
      return;
    }
    if (tag.local === 't') {
      this.textDepth -= 1;
    } else if (tag.local === 'p') {
      this.finishParagraph();
    } else if (tag.local === 'tc' && this.tableDepth === 1) {
      this.finishCell();
    } else if (tag.local === 'tr' && this.tableDepth === 1) {
      this.finishRow();
    } else if (tag.local === 'tbl') {
      this.tableDepth -= 1;
    }
    if (tag.local === 'del' || tag.local === 'moveFrom') {
      this.excludedDepth -= 1;
    }
  }

  /**
   * Appends visible text while bounding the largest in-flight row or paragraph.
   *
   * @param text Visible text fragment.
   */
  private append(text: string): void {
    if (this.excludedDepth > 0 || text === '') {
      return;
    }
    const pending =
      this.tableDepth > 0 ? this.rowCharacters + this.paragraphCharacters : this.paragraphCharacters;
    const remaining = this.maxCharacters - this.emittedCharacters - pending;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = text.slice(0, remaining);
    this.paragraphChunks.push(accepted);
    this.paragraphCharacters += accepted.length;
    if (accepted.length < text.length) {
      this.truncated = true;
    }
  }

  /**
   * Moves the active paragraph into a table cell or emits it as a document unit.
   */
  private finishParagraph(): void {
    const text = this.paragraphChunks.join('');
    this.paragraphChunks = [];
    this.paragraphCharacters = 0;
    if (this.tableDepth > 0) {
      if (text.trim() !== '') {
        this.cellParagraphs.push(text);
        this.rowCharacters += text.length;
      }
      return;
    }
    this.emit('paragraph', text);
  }

  /**
   * Finalizes one table cell while preserving paragraph boundaries within it.
   */
  private finishCell(): void {
    const text = this.cellParagraphs.join('\n');
    this.cellParagraphs = [];
    this.rowCells.push(text);
  }

  /**
   * Emits one table row as tab-separated text for compact LLM consumption.
   */
  private finishRow(): void {
    const text = this.rowCells.join('\t');
    this.rowCells = [];
    this.rowCharacters = 0;
    this.emit('table', text);
  }

  /**
   * Emits a bounded non-empty structured unit.
   *
   * @param type Structured unit type.
   * @param source Unbounded candidate text.
   */
  private emit(type: 'paragraph' | 'table', source: string): void {
    if (source.trim() === '') {
      return;
    }
    if (this.units.length >= this.maxUnits) {
      this.truncated = true;
      return;
    }
    const remaining = this.maxCharacters - this.emittedCharacters;
    const text = source.slice(0, Math.max(0, remaining));
    if (text === '') {
      this.truncated = true;
      return;
    }
    this.units.push({
      locator: { lineFrom: this.line, lineTo: this.line },
      type,
      text,
    });
    this.line += 1;
    this.emittedCharacters += text.length;
    if (text.length < source.length) {
      this.truncated = true;
    }
  }
}

/**
 * Checks whether a namespace-resolved tag belongs to either supported WordprocessingML namespace.
 *
 * @param tag XML tag emitted by saxes.
 */
function isWordTag(tag: SaxesTagNS): boolean {
  return WORD_NAMESPACES.has(tag.uri);
}
