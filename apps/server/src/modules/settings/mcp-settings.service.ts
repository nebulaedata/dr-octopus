/**
 * @author Codex
 * @description Maps the Host-owned Pi MCP store into Settings application use cases and errors.
 */

import { ApplicationError } from '../../lib/errors/application-error.js';
import { PiMcpConfigError } from '../../lib/pi-mcp/index.js';
import type {
  CreateMcpServerBody,
  UpdateMcpServerActivationBody,
  UpdateMcpServerBody,
} from '@octopus/shared/protocol';
import type { PiMcpStore } from '../../lib/pi-mcp/index.js';

/**
 * Owns MCP Settings application behavior while adapter mechanics remain infrastructure details.
 */
export class McpSettingsService {
  /** Creates the service around one Host-owned store. */
  public constructor(private readonly store: PiMcpStore) {}

  /** Lists the effective MCP catalog. */
  public list() {
    return this.#map(() => this.store.list());
  }

  /** Resolves one MCP Server detail. */
  public async get(serverKey: string) {
    const server = await this.#map(() => this.store.get(serverKey));
    if (server === undefined) {
      throw new ApplicationError('MCP_SERVER_NOT_FOUND', 'The MCP Server does not exist.', {
        statusCode: 404,
      });
    }
    return server;
  }

  /** Actively tests the effective MCP Servers from this Host. */
  public probeConnectivity(serverKey?: string) {
    return this.#map(() => this.store.probeConnectivity(serverKey));
  }

  /** Creates one owned MCP Server. */
  public create(input: CreateMcpServerBody) {
    return this.#map(() => this.store.create(input));
  }

  /** Updates one owned MCP Server. */
  public update(serverKey: string, input: UpdateMcpServerBody) {
    return this.#map(() => this.store.update(serverKey, input));
  }

  /** Updates the enabled override for one MCP Server. */
  public setActivation(serverKey: string, input: UpdateMcpServerActivationBody) {
    return this.#map(() => this.store.setActivation(serverKey, input));
  }

  /** Removes one owned definition or Pi-global override. */
  public remove(serverKey: string, revision: string) {
    return this.#map(() => this.store.remove(serverKey, revision));
  }

  /** Translates infrastructure failures into the application error contract. */
  async #map<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PiMcpConfigError) {
        throw new ApplicationError(error.code, error.message, {
          statusCode: error.statusCode,
          retryable: error.statusCode >= 500,
          cause: error,
        });
      }
      throw error;
    }
  }
}
