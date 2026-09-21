#!/usr/bin/env node
/**
 * @author Codex
 * @description Octopus CLI 进程入口，统一处理启动失败
 */
import process from 'node:process';
import { initializeAgentEnvironment } from '../utils/environment.js';

void (async () => {
  initializeAgentEnvironment();
  const { runOctopusCli } = await import('../cli/run-cli.js');
  await runOctopusCli(process.argv.slice(2));
})().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`octopus: ${message}\n`);
  process.exitCode = 1;
});
