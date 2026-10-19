/**
 * @author Codex
 * @description Defines the executor's user-confirmed product identity for desktop presentation, MCP negotiation, and acceptance packaging.
 */
import executorPackage from '../../package.json' with { type: 'json' };

export const executorProduct = {
  name: 'Dr.Octopus Executor',
  version: executorPackage.version,
  mcpName: 'octopus-executor',
} as const;
