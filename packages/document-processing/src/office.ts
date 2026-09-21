/**
 * @author Codex
 * @description Adapts the legacy byte-array Office API to the shared file-stream parser with bounded output.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOfficeFile } from './office-file.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Preserve byte-input callers while using exactly the same Office parsing implementation as file consumers.
 */
export async function parseOffice(
  bytes: Uint8Array,
  format: string,
  options: ParseOptions = { ocrMode: 'off' }
): Promise<ParsedSection[]> {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-office-'));
  try {
    const path = join(directory, 'source');
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const sections: ParsedSection[] = [];
    for await (const section of parseOfficeFile(path, format, {
      ...options,
      temporaryDirectory: directory,
    })) {
      sections.push(section);
    }
    return sections;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
