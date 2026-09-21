#!/usr/bin/env node
/**
 * @author Codex
 * @description Exposes TUI Agent startup, dependency installation, Gateway/Scheduler lifecycle, and diagnostics through Commander.
 */
import { Command, InvalidArgumentError } from 'commander';
import { gatewayError, getGatewayStatus } from './gateway/index.js';
import { ensureDependencies, installDependencies } from './dependencies.js';
import { cliCommand, distribution, isPackaged } from './distribution/location.js';
import { doctor } from './doctor.js';
import { startGateway, stopGateway, healthGateway, preflightGateway } from './gateway.js';
import { report } from './output.js';
import { schedulerAction } from './scheduler.js';
import { knowledgeAction } from './knowledge.js';
import { startTui } from './tui.js';
import { listRuntimes, pruneRuntimes } from './runtimes.js';
import { registryUrl } from './install-registry.js';
import type { GatewayOptions } from './gateway.js';
import type { OutputOptions } from './output.js';
import type { DependencyOptions } from './dependencies.js';

/**
 * Rejects invalid timeouts before launching or stopping any process.
 */
function timeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 900_000) {
    throw new InvalidArgumentError('Timeout must be 1000–900000 milliseconds.');
  }
  return parsed;
}

/**
 * Wraps every action in one machine-readable service/result/error contract.
 */
function action<T extends OutputOptions>(
  service: string,
  name: string,
  run: (options: T) => Promise<unknown>
) {
  return async (options: T) => {
    try {
      report(service, name, await run({ ...program.opts(), ...options }), options);
    } catch (error) {
      report(service, name, undefined, options, error);
    }
  };
}

const program = new Command()
  .name(cliCommand())
  .description('Run the Octopus TUI agent and manage the local Gateway and Scheduler')
  .enablePositionalOptions()
  .version(isPackaged() ? distribution().layout.version : '0.0.0')
  .option('--install-deps', 'Install missing runtime dependencies without prompting');
program.exitOverride();
program
  .command('tui')
  .description('Start the interactive octopus agent in this terminal')
  .argument('[agent-args...]', 'Arguments forwarded to octopus, e.g. --workspace general')
  .option('--install-deps', 'Install missing runtime dependencies before starting')
  .allowUnknownOption()
  .passThroughOptions()
  .addHelpText(
    'after',
    '\nPlace --yes, --registry and --install-deps before Agent arguments. Use tui -- --help for Agent help.'
  )
  .action(async (args: string[], options: DependencyOptions) => {
    try {
      process.exitCode = await startTui(args, {
        ...program.opts<DependencyOptions>(),
        ...options,
        installDeps: options.installDeps || program.opts<DependencyOptions>().installDeps,
      });
    } catch (error) {
      report('tui', 'run', undefined, {}, error);
    }
  });
program
  .command('deps')
  .description('Manage release npm dependencies')
  .command('install')
  .description('Install and verify frozen npm dependencies; Pi extensions are installed at Server startup')
  .option('--json', 'Emit JSON')
  .action(action('deps', 'install', installDependencies));

const runtimes = program.command('runtimes').description('Inspect and prune installed runtime directories');
runtimes.action(() => runtimes.outputHelp());
runtimes
  .command('list')
  .description('List runtime versions, logical size and usage; does not install dependencies')
  .option('--json', 'Emit JSON')
  .action(action('runtimes', 'list', () => listRuntimes()));
runtimes
  .command('prune')
  .description('Remove unused old runtimes, preserving the current installed runtime')
  .option('--dry-run', 'Preview candidates without deleting or writing files')
  .option('--json', 'Emit JSON')
  .action(action('runtimes', 'prune', pruneRuntimes));

const gateway = program.command('gateway').description('Manage the unique Gateway for this OS user');
for (const name of ['run', 'start', 'restart']) {
  const command = gateway
    .command(name)
    .option('--json', 'Emit JSON')
    .option('--install-deps', 'Install missing runtime dependencies before starting')
    .option('--file-log', 'Enable Server JSONL files')
    .option('--no-file-log', 'Disable Server JSONL files')
    .option('--timeout <ms>', 'Startup timeout including extension installation', timeout, 180_000)
    .option('--inspect <address>', 'Server inspector address, for example 127.0.0.1:9230');
  if (name === 'run') {
    command.option(
      '--dev-entry <path>',
      'Absolute Server module exporting createServerRuntime (src/runtime.ts)'
    );
  }
  command.action(
    action<GatewayOptions>('gateway', name, async (options) => {
      options.installDeps ||= program.opts<DependencyOptions>().installDeps;
      if (process.argv.includes('--file-log') && process.argv.includes('--no-file-log')) {
        throw gatewayError('CONFLICTING_OPTIONS', '--file-log and --no-file-log cannot be used together.');
      }
      const previous = name === 'restart' ? await getGatewayStatus() : undefined;
      if (name === 'restart') {
        await preflightGateway(options, previous);
        await stopGateway();
      }
      return startGateway(options, name === 'run', previous);
    })
  );
}
gateway
  .command('stop')
  .option('--json', 'Emit JSON')
  .action(action('gateway', 'stop', () => stopGateway()));
gateway
  .command('status')
  .option('--json', 'Emit JSON')
  .action(action('gateway', 'status', async () => (await getGatewayStatus()) ?? { state: 'stopped' }));
gateway
  .command('health')
  .option('--json', 'Emit JSON')
  .action(action('gateway', 'health', () => healthGateway()));

const scheduler = program.command('scheduler').description('Manage the independent Agent Scheduler');
const knowledge = program.command('knowledge').description('Manage the shared knowledge service');
const knowledgeService = knowledge.command('service').description('Alias for knowledge lifecycle commands');
for (const parent of [knowledge, knowledgeService]) {
  for (const name of ['start', 'stop', 'restart', 'status', 'health']) {
    const command = parent
      .command(name)
      .option('--json', 'Emit JSON')
      .option('--agent-dir <path>', 'Agent data directory');
    if (name === 'start' || name === 'restart') {
      command.option('--install-deps', 'Install missing runtime dependencies before starting');
    }
    command.action(
      action<DependencyOptions & { agentDir?: string }>('knowledge', name, (options) =>
        knowledgeAction(name, options.agentDir, {
          ...options,
          installDeps: options.installDeps || program.opts<DependencyOptions>().installDeps,
        })
      )
    );
  }
}
const schedulerService = scheduler.command('service').description('Manage Scheduler service lifecycle');
for (const parent of [scheduler, schedulerService]) {
  for (const name of ['start', 'stop', 'restart', 'status']) {
    const command = parent
      .command(name)
      .option('--json', 'Emit JSON')
      .option('--agent-dir <path>', 'Agent data directory');
    if (name === 'start' || name === 'restart') {
      command.option('--install-deps', 'Install missing runtime dependencies before starting');
    }
    command.action(
      action<DependencyOptions & { agentDir?: string }>('scheduler', name, (options) =>
        schedulerAction(name, options.agentDir, {
          ...options,
          installDeps: options.installDeps || program.opts<DependencyOptions>().installDeps,
        })
      )
    );
  }
}
program
  .command('doctor')
  .description('Read-only checks; no services, repairs or model calls')
  .option('--json', 'Emit JSON')
  .action(
    action('doctor', 'check', async () => {
      const result = await doctor();
      if (!result.healthy) {
        process.exitCode = 1;
      }
      return result;
    })
  );
program
  .command('migrate')
  .description('Reserved deployment migration command (not implemented)')
  .option('--json', 'Emit JSON')
  .action(
    action('migrate', 'run', () =>
      Promise.reject(gatewayError('NOT_IMPLEMENTED', 'Deployment migration is not implemented.'))
    )
  );

/**
 * Registers the same install controls at the root and every existing installation entry point.
 */
function addInstallOptions(command: Command): void {
  if (
    command.options.some((option) => option.long === '--install-deps') ||
    (command.name() === 'install' && command.parent?.name() === 'deps')
  ) {
    command
      .option('-y, --yes', 'Confirm dependency installation without prompting')
      .option('--registry <url>', 'Use this npm registry for this dependency installation', registryUrl);
  }
  command.commands.forEach(addInstallOptions);
}
addInstallOptions(program);
program.action(async (options: DependencyOptions) => {
  if (isPackaged()) {
    await ensureDependencies(options);
  }
  program.outputHelp();
});

try {
  await program.parseAsync(process.argv.slice(2), { from: 'user' });
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code !== 'commander.helpDisplayed' && code !== 'commander.version') {
    report('cli', 'parse', undefined, { json: process.argv.includes('--json') }, error);
  }
}
