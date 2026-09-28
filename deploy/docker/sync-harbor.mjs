/**
 * @author Codex
 * @description Copies a published Docker Hub image to Harbor by digest using existing Docker credentials.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { image } from './release.mjs';

const help = `Usage: node deploy/docker/sync-harbor.mjs [options]

  --project <name>    Existing Harbor project (default: nebulae)
  --tag <tag>         Docker Hub tag to copy unchanged (default: latest)
  --registry <host>   Harbor host[:port] (default: harbor.n.nebulaedata.com)
  --dry-run          Resolve the source digest and print the plan without pushing
  --yes              Skip prompts and login; use existing Docker credentials
  --help             Show this help

Interactive mode guides docker login, project selection and final confirmation.
For --yes, run docker login <Harbor host> first. Both registries must be reachable.
Existing destination tags are updated; Harbor tag immutability rules still apply.
No image build, project creation, deployment, or automatic recurring sync is performed.`;

/**
 * Validates a single-project destination and tag before invoking Docker; credentials are never CLI options.
 */
export function syncOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: 'string', default: 'nebulae' },
      tag: { type: 'string', default: 'latest' },
      registry: { type: 'string', default: 'harbor.n.nebulaedata.com' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  if (values.help) return values;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(values.project ?? ''))
    throw new Error('--project must be an existing lowercase Harbor project name.');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(values.tag) || /\s/.test(values.tag))
    throw new Error('--tag must be a Docker tag, for example latest or 0.0.10-r1.');
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::[0-9]{1,5})?$/.test(
      values.registry
    ) ||
    /\s/.test(values.registry)
  )
    throw new Error('--registry must be a host[:port], without https:// or /harbor/projects.');
  if (/\s/.test(values.project)) throw new Error('--project cannot contain whitespace.');
  const port = values.registry.split(':')[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
    throw new Error('--registry port must be between 1 and 65535.');
  return values;
}

/**
 * Runs Docker without shell expansion and exposes progress/errors without reading or storing credentials.
 */
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
    timeout: 1_800_000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

/**
 * Pins the source once, copies its manifest/layers and verifies the destination tag against that snapshot.
 * A dry run only reads source metadata. Failures stop immediately and never report synchronization success.
 */
export async function syncHarbor(args, { run = docker, log = console.log, confirm = async () => true } = {}) {
  const options = syncOptions(args);
  if (options.help) {
    log(help);
    return;
  }
  const source = `${image}:${options.tag}`;
  const target = `${options.registry}/${options.project}/dr-octopus:${options.tag}`;
  const inspect = ['buildx', 'imagetools', 'inspect'];
  const format = ['--format', '{{.Manifest.Digest}}'];
  const digest = run([...inspect, source, ...format]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Source returned an invalid image digest.');
  const pinned = `${image}@${digest}`;
  log(`Source: ${source}\nSnapshot: ${pinned}\nDestination: ${target}`);
  if (options['dry-run']) {
    log('Dry run: no destination writes or Harbor permission checks performed.');
    return { source: pinned, target, digest, copied: false };
  }
  if (!(await confirm({ source: pinned, target, digest })))
    return { source: pinned, target, digest, copied: false, cancelled: true };
  // Preserve single-platform manifests too, rather than wrapping them in a new index.
  run(['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', target, pinned]);
  const actual = run([...inspect, target, ...format]).trim();
  if (actual !== digest)
    throw new Error(
      `Harbor digest mismatch: expected ${digest}, received ${actual}. Synchronization unverified.`
    );
  log(`Verified: ${target}@${digest}`);
  return { source: pinned, target, digest, copied: true };
}

/**
 * Selects interactive guidance or explicit automation without loading prompt dependencies in release CI.
 */
export async function runHarborCli(
  args,
  { interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY), sync = syncHarbor } = {}
) {
  const options = syncOptions(args);
  if (options.help || options.yes || options['dry-run']) return sync(args);
  if (!interactive) throw new Error('Noninteractive synchronization requires --yes (or --dry-run).');
  const { interactiveSync } = await import('./sync-harbor-interactive.mjs');
  return interactiveSync(options, { sync, validateOptions: syncOptions });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runHarborCli(process.argv.slice(2));
    if (result?.cancelled) process.exitCode = 130;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
