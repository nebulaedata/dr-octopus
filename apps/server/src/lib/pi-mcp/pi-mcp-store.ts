/**
 * @author Codex
 * @description Orchestrates effective MCP discovery and serialized Pi-global Settings mutations.
 */

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { getMcpDiscoverySummary, getServerProvenance, loadMcpConfig } from 'pi-mcp-adapter/config';
import { McpConnectivityProbe } from './connectivity-probe.js';
import { PiMcpDocumentRepository } from './document-repository.js';
import { applyMcpConfiguration, projectMcpServerDetail } from './projection.js';
import { PiMcpConfigError } from './types.js';
import type { McpServerDetailDto, McpServerMutationDto, McpServerSummaryDto } from '@octopus/shared/protocol';
import type { CreatePiMcpStoreOptions, PiMcpAdapterConfigApi, PiMcpConfig, PiMcpStore } from './types.js';

interface Snapshot {
  config: PiMcpConfig;
  effectiveConfig: PiMcpConfig;
  details: McpServerDetailDto[];
  revision: string;
}

const MCP_ADAPTER_VERSION = '2.34.0' as const;
const MCP_ADAPTER_CONFIG_API: PiMcpAdapterConfigApi = {
  loadMcpConfig,
  getMcpDiscoverySummary,
  getServerProvenance,
};

/** Projects the catalog fields without relying on unused-rest destructuring. */
function toSummary(detail: McpServerDetailDto): McpServerSummaryDto {
  return {
    serverKey: detail.serverKey,
    name: detail.name,
    transport: detail.transport,
    enabled: detail.enabled,
    source: detail.source,
    management: detail.management,
    conflictCount: detail.conflictCount,
    effect: detail.effect,
  };
}

/**
 * Creates the Server Host MCP configuration store.
 */
export function createPiMcpStore(options: CreatePiMcpStoreOptions): PiMcpStore {
  return new DefaultPiMcpStore(options);
}

class DefaultPiMcpStore implements PiMcpStore {
  readonly #repository: PiMcpDocumentRepository;
  readonly #cwd: string;
  readonly #globalPath: string;
  readonly #connectivity: McpConnectivityProbe;
  #mutationTail: Promise<void> = Promise.resolve();

  /**
   * Creates a store bound to one Agent home and one deterministic discovery directory.
   */
  public constructor(private readonly options: CreatePiMcpStoreOptions) {
    this.#cwd = options.controlPlaneCwd ?? options.agentDir;
    this.#globalPath = join(options.agentDir, 'mcp.json');
    this.#repository = new PiMcpDocumentRepository(this.#globalPath);
    this.#connectivity = new McpConnectivityProbe({ cwd: this.#cwd, agentDir: options.agentDir });
  }

  /** Lists effective Servers in stable name order. */
  public async list() {
    const snapshot = await this.#snapshot();
    return {
      servers: snapshot.details.map(toSummary),
      adapter: { package: 'pi-mcp-adapter' as const, version: MCP_ADAPTER_VERSION, available: true },
      revision: snapshot.revision,
    };
  }

  /** Resolves a Server by opaque key. */
  public async get(serverKey: string) {
    return (await this.#snapshot()).details.find((server) => server.serverKey === serverKey);
  }

  /** Probes each effective Server through an isolated Host-owned MCP client. */
  public async probeConnectivity(serverKey?: string) {
    const snapshot = await this.#snapshot();
    const details = serverKey === undefined ? snapshot.details : [this.#requireServer(snapshot, serverKey)];
    return this.#connectivity.probe(
      snapshot.revision,
      details.map((server) => ({
        serverKey: server.serverKey,
        entry: snapshot.effectiveConfig.mcpServers[server.name] ?? { disabled: true },
      }))
    );
  }

  /** Creates a complete Pi-global Server definition. */
  public create(input: Parameters<PiMcpStore['create']>[0]) {
    return this.#mutate(input.revision, (snapshot) => {
      if (snapshot.details.some((server) => server.name === input.name)) {
        throw new PiMcpConfigError(
          'MCP_SERVER_CONFLICT',
          'An MCP Server with this name already exists.',
          409
        );
      }
      snapshot.config.mcpServers[input.name] = applyMcpConfiguration({}, input);
      return input.name;
    });
  }

  /** Updates an owned Pi-global Server definition. */
  public update(serverKey: string, input: Parameters<PiMcpStore['update']>[1]) {
    return this.#mutate(input.revision, (snapshot) => {
      const server = this.#requireServer(snapshot, serverKey);
      if (server.management !== 'owned') {
        this.#readonly();
      }
      snapshot.config.mcpServers[server.name] = applyMcpConfiguration(
        snapshot.config.mcpServers[server.name] ?? {},
        input
      );
      return server.name;
    });
  }

  /** Enables or disables an owned definition or lower-layer override. */
  public setActivation(serverKey: string, input: Parameters<PiMcpStore['setActivation']>[1]) {
    return this.#mutate(input.revision, (snapshot) => {
      const server = this.#requireServer(snapshot, serverKey);
      if (!server.capabilities.toggle) {
        this.#readonly();
      }
      const current = snapshot.config.mcpServers[server.name];
      snapshot.config.mcpServers[server.name] = {
        ...(current ?? {}),
        ...(input.enabled ? { disabled: false } : { disabled: true }),
      };
      return server.name;
    });
  }

  /** Removes an owned definition or the Pi-global override currently shadowing a lower source. */
  public remove(serverKey: string, revision: string) {
    return this.#mutate(revision, (snapshot) => {
      const server = this.#requireServer(snapshot, serverKey);
      if (!server.capabilities.remove || snapshot.config.mcpServers[server.name] === undefined) {
        this.#readonly();
      }
      delete snapshot.config.mcpServers[server.name];
      return undefined;
    });
  }

  /** Serializes mutations and returns a post-write effective snapshot. */
  async #mutate(
    revision: string,
    change: (snapshot: Snapshot) => string | undefined
  ): Promise<McpServerMutationDto> {
    let release!: () => void;
    const preceding = this.#mutationTail;
    this.#mutationTail = new Promise<void>((resolveTail) => (release = resolveTail));
    await preceding;
    try {
      const snapshot = await this.#snapshot();
      if (snapshot.revision !== revision) {
        throw new PiMcpConfigError('MCP_CONFIG_REVISION_CONFLICT', 'The MCP configuration changed.', 409);
      }
      const name = change(snapshot);
      await this.#repository.write(snapshot.config);
      const updated = await this.#snapshot();
      return {
        outcome: 'applied',
        warnings: [],
        effect: { kind: 'agent_restart', currentAgentRuntimes: 'unchanged', requiredAction: 'restart_agent' },
        revision: updated.revision,
        ...(name === undefined ? {} : { server: updated.details.find((server) => server.name === name) }),
      };
    } finally {
      release();
    }
  }

  /** Loads one coherent adapter and writable-document snapshot. */
  async #snapshot(): Promise<Snapshot> {
    const [{ api }, document] = await Promise.all([this.#getAdapter(), this.#repository.read()]);
    const loaded = this.#withAgentDir(() => ({
      config: api.loadMcpConfig(undefined, this.#cwd),
      discovery: api.getMcpDiscoverySummary(undefined, this.#cwd, { includeHostConfigs: true }),
      provenance: api.getServerProvenance(undefined, this.#cwd),
    }));
    const sourcePaths = new Map(loaded.discovery.sources.map((source) => [resolve(source.path), source.id]));
    const conflicts = new Map(
      loaded.discovery.conflicts.map((conflict) => [conflict.serverName, conflict.sources.length])
    );
    const details = Object.entries(loaded.config.mcpServers)
      .map(([name, entry]) =>
        projectMcpServerDetail(name, entry, {
          globalServers: document.config.mcpServers,
          provenance: loaded.provenance,
          sourcePaths,
          conflicts,
        })
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      config: document.config,
      effectiveConfig: loaded.config,
      details,
      revision: createHash('sha256')
        .update(JSON.stringify(loaded.config))
        .update('\0')
        .update(document.raw)
        .digest('base64url'),
    };
  }

  /** Selects the project-installed public adapter API or an injected test double. */
  #getAdapter(): Promise<{ api: PiMcpAdapterConfigApi; version: string }> {
    return Promise.resolve({
      api: this.options.adapterApi ?? MCP_ADAPTER_CONFIG_API,
      version: this.options.adapterVersion ?? MCP_ADAPTER_VERSION,
    });
  }

  /** Temporarily points synchronous adapter discovery at the configured Agent home. */
  #withAgentDir<T>(operation: () => T): T {
    const previousPi = process.env.PI_CODING_AGENT_DIR;
    const previousOctopus = process.env.DR_OCTOPUS_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = this.options.agentDir;
    process.env.DR_OCTOPUS_CODING_AGENT_DIR = this.options.agentDir;
    try {
      return operation();
    } finally {
      if (previousPi === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousPi;
      }
      if (previousOctopus === undefined) {
        delete process.env.DR_OCTOPUS_CODING_AGENT_DIR;
      } else {
        process.env.DR_OCTOPUS_CODING_AGENT_DIR = previousOctopus;
      }
    }
  }

  /** Resolves a Server or raises the stable not-found error. */
  #requireServer(snapshot: Snapshot, key: string): McpServerDetailDto {
    const server = snapshot.details.find((candidate) => candidate.serverKey === key);
    if (server === undefined) {
      throw new PiMcpConfigError('MCP_SERVER_NOT_FOUND', 'The MCP Server does not exist.', 404);
    }
    return server;
  }

  /** Raises the stable capability error. */
  #readonly(): never {
    throw new PiMcpConfigError('MCP_SERVER_READONLY', 'This MCP Server is not editable at its source.', 422);
  }
}
