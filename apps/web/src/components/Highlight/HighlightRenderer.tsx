/**
 * @author Codex
 * @description Highlights a bounded set of common code languages with the highlight.js core build.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { cn } from '@octopus/ui/lib/utils';
import { HighlightTheme } from './HighlightTheme';
import type { HighlightProps } from './index';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/**
 * Converts source text to highlight.js markup using a pre-registered language grammar.
 */
export default function HighlightRenderer({
  children,
  className,
  language = 'plaintext',
  ...props
}: HighlightProps) {
  const highlightedCode = hljs.highlight(children, { language }).value;

  return (
    <>
      <HighlightTheme />
      <pre className={cn('max-w-full overflow-auto rounded-lg text-xs', className)} {...props}>
        <code
          className={`hljs language-${language} min-w-full w-fit`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </>
  );
}
