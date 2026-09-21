/**
 * @author Codex
 * @description Persists the Server-owned Pi global MCP document without discarding unknown fields.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PiMcpConfigError } from './types.js';
import type { PiMcpConfig } from './types.js';

export interface PiMcpDocument {
  config: PiMcpConfig;
  raw: string;
}

/**
 * Reads and atomically replaces the single Host-owned mcp.json document.
 */
export class PiMcpDocumentRepository {
  /**
   * Creates a repository for an explicit absolute configuration path.
   */
  public constructor(private readonly path: string) {}

  /**
   * Reads the current document, treating a missing file as an empty configuration.
   */
  public async read(): Promise<PiMcpDocument> {
    let raw = '{}\n';
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error();
      }
      const config = parsed as Partial<PiMcpConfig>;
      if (
        config.mcpServers !== undefined &&
        (typeof config.mcpServers !== 'object' ||
          config.mcpServers === null ||
          Array.isArray(config.mcpServers))
      ) {
        throw new Error();
      }
      return { config: { ...config, mcpServers: config.mcpServers ?? {} }, raw };
    } catch (error) {
      throw new PiMcpConfigError('MCP_CONFIG_INVALID', 'The Pi MCP configuration is invalid JSON.', 422, {
        cause: error,
      });
    }
  }

  /**
   * Writes a complete document through a same-directory atomic rename.
   */
  public async write(config: PiMcpConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
