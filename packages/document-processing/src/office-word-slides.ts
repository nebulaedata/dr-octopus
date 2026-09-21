/**
 * @author Codex
 * @description Streams visible Word paragraphs/table rows and DrawingML slide text with stable source locators.
 */
import { posix } from 'node:path';
import { isLegacyWordEquation, nodes, relationshipTarget, xmlEvents } from './office-container.js';
import { DocumentProcessingError } from './types.js';
import type { OfficeContainer } from './office-container.js';
import type { ParsedSection } from './types.js';

const WORD = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

/**
 * Bound an in-flight paragraph/row independently of the consumer's total output limit.
 */
function append(current: string, value: string): string {
  if (current.length + value.length > 1_048_576) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', 'Office 单段文本超过限制');
  }
  return current + value;
}

/**
 * Include body, notes, headers and footers while excluding deleted revisions and field instructions.
 */
export async function* wordSections(container: OfficeContainer): AsyncGenerator<ParsedSection> {
  const parts = [
    'word/document.xml',
    ...[...container.entries.keys()]
      .filter((name) => /^word\/(footnotes|endnotes|header\d+|footer\d+)\.xml$/u.test(name))
      .sort(),
  ];
  let paragraph = 0;
  for (const part of parts) {
    let text = '';
    let visible = 0;
    let excluded = 0;
    let table = 0;
    for await (const event of xmlEvents(container, part)) {
      if (event.type === 'text') {
        if (visible && !excluded) {
          text = append(text, event.text);
        }
        continue;
      }
      if (event.type === 'open' && !excluded && isLegacyWordEquation(event.tag)) {
        text = append(text, '[嵌入公式，未提取为文本]');
      }
      if (!WORD.has(event.tag.uri)) {
        continue;
      }
      const name = event.tag.local;
      if (event.type === 'open') {
        if (name === 'del' || name === 'moveFrom') {
          excluded++;
        }
        if (name === 't') {
          visible++;
        }
        if (name === 'tbl') {
          table++;
        }
        if (!excluded) {
          if (name === 'tab') {
            text = append(text, '\t');
          }
          if (name === 'br' || name === 'cr') {
            text = append(text, '\n');
          }
          if (name === 'noBreakHyphen') {
            text = append(text, '-');
          }
          if (name === 'softHyphen') {
            text = append(text, '\u00ad');
          }
        }
      } else {
        if (name === 't') {
          visible--;
        }
        if (name === 'del' || name === 'moveFrom') {
          excluded--;
        }
        if (name === 'tc' && table === 1) {
          text = append(text.trimEnd(), '\t');
        }
        if (name === 'p' && table) {
          text = append(text, '\n');
        }
        if ((name === 'p' && !table) || (name === 'tr' && table === 1)) {
          if (text.trim()) {
            yield {
              text: text.trimEnd(),
              locator: { paragraph: ++paragraph },
              extractionMethod: 'text',
              type: table ? 'table' : 'paragraph',
            };
          }
          text = '';
        }
        if (name === 'tbl') {
          table--;
        }
      }
    }
  }
}

/**
 * Stream DrawingML paragraphs instead of accumulating an entire slide or its XML tree.
 */
async function* drawingSections(
  container: OfficeContainer,
  part: string,
  slide: number,
  notes = false
): AsyncGenerator<ParsedSection> {
  let visible = false;
  let text = '';
  for await (const event of xmlEvents(container, part)) {
    if (event.type === 'text') {
      if (visible) {
        text = append(text, event.text);
      }
    } else if (event.type === 'open') {
      if (event.tag.local === 't') {
        visible = true;
      }
      if (event.tag.local === 'br') {
        text = append(text, '\n');
      }
    } else {
      if (event.tag.local === 't') {
        visible = false;
      }
      if (event.tag.local === 'p') {
        if (text.trim()) {
          yield { text: (notes ? '演讲者备注：' : '') + text, locator: { slide }, extractionMethod: 'text' };
        }
        text = '';
      }
    }
  }
}

/**
 * Follow presentation relationship order, including the matching speaker notes only.
 */
export async function* slideSections(container: OfficeContainer): AsyncGenerator<ParsedSection> {
  const relationships = await nodes(container, 'ppt/_rels/presentation.xml.rels', 'Relationship');
  const targets = new Map(
    relationships.filter((item) => item.Type?.endsWith('/slide')).map((item) => [item.Id, item.Target!])
  );
  const slides = await nodes(container, 'ppt/presentation.xml', 'sldId');
  if (slides.length > 500) {
    throw new DocumentProcessingError('DOCUMENT_LIMIT', '幻灯片数量超过限制');
  }
  const seen = new Set<string>();
  for (const [index, slide] of slides.entries()) {
    const target = targets.get(slide['r:id']);
    if (!target) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'PPT 幻灯片关系缺失');
    }
    const name = relationshipTarget(container, 'ppt/presentation.xml', target);
    if (!/^ppt\/slides\/[^/]+\.xml$/u.test(name) || seen.has(name)) {
      throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'PPT 幻灯片关系无效');
    }
    seen.add(name);
    yield* drawingSections(container, name, index + 1);
    const rels = `ppt/slides/_rels/${posix.basename(name)}.rels`;
    if (container.entries.has(rels)) {
      for (const relation of await nodes(container, rels, 'Relationship')) {
        if (relation.Type?.endsWith('/notesSlide')) {
          const note = relationshipTarget(container, name, relation.Target ?? '');
          if (!/^ppt\/notesSlides\/[^/]+\.xml$/u.test(note)) {
            throw new DocumentProcessingError('OFFICE_CONTENT_REJECTED', 'PPT 备注关系无效');
          }
          yield* drawingSections(container, note, index + 1, true);
        }
      }
    }
  }
}
