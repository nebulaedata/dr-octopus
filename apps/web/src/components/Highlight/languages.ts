/**
 * @author Codex
 * @description Defines the intentionally bounded syntax set and filename-to-language mapping.
 */

export type HighlightLanguage =
  | 'bash'
  | 'css'
  | 'diff'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'plaintext'
  | 'python'
  | 'sql'
  | 'typescript'
  | 'xml'
  | 'yaml';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, HighlightLanguage>> = {
  '.bash': 'bash',
  '.css': 'css',
  '.diff': 'diff',
  '.htm': 'xml',
  '.html': 'xml',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.patch': 'diff',
  '.py': 'python',
  '.sh': 'bash',
  '.sql': 'sql',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

/**
 * Infers one of the deliberately bundled languages from a file path.
 */
export function getHighlightLanguage(filePath: string | undefined): HighlightLanguage {
  if (filePath === undefined) {
    return 'plaintext';
  }

  const normalizedPath = filePath.toLowerCase();
  const extensionStart = normalizedPath.lastIndexOf('.');
  if (extensionStart === -1) {
    return 'plaintext';
  }

  return LANGUAGE_BY_EXTENSION[normalizedPath.slice(extensionStart)] ?? 'plaintext';
}
