/**
 * @author Codex
 * @description Validates streamed attachment text without retaining its contents.
 */
import type { PreflightSource } from './types.js';
/**
 * Validates text as strict UTF-8 without retaining the complete file in memory.
 */
export async function isStrictUtf8(source: PreflightSource): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    const { stream } = await source.openRead();
    for await (const chunk of stream) {
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}
