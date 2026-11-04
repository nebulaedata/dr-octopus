/**
 * @author Codex
 * @description Copies a published Docker Hub image to Harbor by digest using existing Docker credentials.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { image } from './release.mjs';

const releaseVersion = JSON.parse(readFileSync(new URL('../../release.config.json', import.meta.url), 'utf8'))
  .manifest.version;
const defaultTags = `${releaseVersion},latest`;

const help = `Usage: node deploy/docker/sync-harbor.mjs [options]

  --project <name>    Existing Harbor project (default: nebulae)
  --tag <tags>        Comma-separated source tags (default: ${defaultTags})
  --registry <host>   Harbor host[:port] (default: harbor.n.nebulaedata.com)
  --dry-run          Resolve the source digest and print the plan without pushing
  --yes              Skip prompts and login; use existing Docker credentials
  --help             Show this help

Interactive mode guides docker login, project selection and final confirmation.
For --yes, run docker login <Harbor host> first. Both registries must be reachable.
Existing destination tags are updated; Harbor tag immutability rules still apply.
No image build, project creation, deployment, or automatic recurring sync is performed.`;

/**
 * Validates a single-project destination and deduplicates comma-separated tags before invoking Docker; credentials are never CLI options.
 */
export function syncOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: 'string', default: 'nebulae' },
      tag: { type: 'string', default: defaultTags },
      registry: { type: 'string', default: 'harbor.n.nebulaedata.com' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
  });
  if (values.help) return values;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(values.project ?? ''))
    throw new Error('--project must be an existing lowercase Harbor project name.');
  const tags = values.tag.split(',').map((tag) => tag.trim());
  if (/[\r\n]/.test(values.tag) || tags.some((tag) => !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag)))
    throw new Error('--tag must contain comma-separated Docker tags, for example latest,0.0.19.');
  values.tags = [...new Set(tags)];
  values.tag = values.tags.join(',');
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
function docker(args, { signal, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1_800_000,
        maxBuffer: 4 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
        } else resolve(stdout.trim());
      }
    );
    child.stdin.end();
    if (!quiet) child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  });
}

/**
 * Retries only evidenced transport/service failures; invalid credentials, certificates and cancellation stop.
 */
function transientRegistryError(error) {
  if (error.killed || error.signal) return false;
  const detail = String(error.stderr || error.message);
  if (
    /unauthorized|forbidden|denied|invalid credentials|incorrect username|x509|certificate|\b(?:401|403|404)\b/i.test(
      detail
    )
  )
    return false;
  return /\b(?:EOF|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|connection reset|i\/o timeout|TLS handshake timeout|timeout awaiting response headers|\b(?:429|500|502|503|504)\b/i.test(
    detail
  );
}

/**
 * Pins each selected source once, copies its manifest/layers and verifies each destination against its snapshot.
 * A dry run only reads source metadata. Network retries preserve the snapshot and verify ambiguous writes.
 */
export async function syncHarbor(
  args,
  { run = docker, log = console.log, confirm = async () => true, pause = sleep, status, signal } = {}
) {
  const options = syncOptions(args);
  if (options.help) {
    log(help);
    return;
  }
  const repository = `${options.registry}/${options.project}/dr-octopus`;
  const inspect = ['buildx', 'imagetools', 'inspect'];
  const format = ['--format', '{{.Manifest.Digest}}'];

  /**
   * Bounds retries to three attempts; writes require a successful destination-state check before retrying.
   */
  async function request(command, message, recover) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      status?.(`${message}（第 ${attempt + 1}/3 次）`);
      try {
        const result = await run(command, { signal, quiet: Boolean(status) });
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        if (!transientRegistryError(error)) throw error;
        if (recover && (await recover())) return '';
        if (attempt >= 2)
          throw new Error(
            'Registry network request failed after 3 attempts. Check access/proxy settings for auth.docker.io, registry-1.docker.io and Harbor, then retry.',
            { cause: error }
          );
        const delay = [2000, 5000][attempt];
        const message = `镜像仓库连接暂时失败，${delay / 1000} 秒后重试（第 ${attempt + 2}/3 次）。`;
        log(message);
        status?.(message);
        await pause(delay, undefined, { signal });
      }
    }
  }

  const plans = [];
  // Resolve every source before confirmation so a missing tag cannot cause a partial sync.
  for (const tag of options.tags) {
    const source = `${image}:${tag}`;
    const digest = (
      await request([...inspect, source, ...format], `正在读取 Docker Hub 源镜像摘要：${tag}`)
    ).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Source returned an invalid image digest.');
    plans.push({ source: `${image}@${digest}`, target: `${repository}:${tag}`, digest });
  }
  const latest = plans.find((plan) => plan.target === `${repository}:latest`);
  const versions = plans.filter((plan) => plan !== latest);
  if (latest && versions.length) {
    // Match image config identity, which also pins the ordered uncompressed layer hashes.
    const configs = new Map();
    /**
     * Reads a pinned single-platform manifest to compare image identity across registry formats.
     */
    async function configDigest(plan) {
      if (!configs.has(plan.digest)) {
        const manifest = JSON.parse(
          await request([...inspect, plan.source, '--raw'], '正在核对 latest 与版本镜像内容')
        );
        if (!/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest ?? ''))
          throw new Error('Expected a single-platform image config digest; no Harbor tags were written.');
        configs.set(plan.digest, manifest.config.digest);
      }
      return configs.get(plan.digest);
    }
    let canonical;
    for (const version of versions) {
      if (
        version.digest === latest.digest ||
        (await configDigest(version)) === (await configDigest(latest))
      ) {
        canonical = version;
        break;
      }
    }
    if (!canonical)
      throw new Error(
        'Selected versions do not match Docker Hub latest; sync an old version without latest. No Harbor tags were written.'
      );
    latest.digest = canonical.digest;
    // Retag inside Harbor only after the version copy has passed digest verification.
    latest.source = `${repository}@${canonical.digest}`;
    plans.splice(plans.indexOf(latest), 1);
    plans.push(latest);
  }
  const targets = plans.map((plan) => plan.target);
  const result = { ...plans[0], targets, plans, copied: false };
  log(plans.map((plan) => `Source: ${plan.source}\nDestination: ${plan.target}`).join('\n'));
  if (options['dry-run']) {
    log('Dry run: no destination writes or Harbor permission checks performed.');
    return result;
  }
  if (!(await confirm(result))) return { ...result, cancelled: true };
  for (const { target: destination, digest: expected, source: snapshot } of plans) {
    // Preserve single-platform manifests too, rather than wrapping them in a new index.
    await request(
      ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', destination, snapshot],
      '正在同步镜像到 Harbor',
      async () => {
        let current;
        try {
          current = (
            await request([...inspect, destination, ...format], '连接中断，正在核实 Harbor 目标状态')
          ).trim();
        } catch (error) {
          signal?.throwIfAborted();
          const detail = String(error.stderr || error.message);
          if (
            /manifest unknown|no such manifest|: not found\s*$/i.test(detail) &&
            !/unauthorized|forbidden|denied|credential/i.test(detail)
          )
            return false;
          throw new Error(
            'Copy interrupted and destination state could not be verified; no automatic re-push. Check Harbor access and retry manually.',
            { cause: error }
          );
        }
        if (!/^sha256:[a-f0-9]{64}$/.test(current))
          throw new Error('Destination returned an invalid image digest; no automatic re-push.');
        if (current === expected) log('连接中断后核对到目标摘要已一致，将继续最终校验。');
        return current === expected;
      }
    );
    const actual = (await request([...inspect, destination, ...format], '正在校验 Harbor 目标摘要')).trim();
    if (actual !== expected)
      throw new Error(
        `Harbor digest mismatch: expected ${expected}, received ${actual}. Synchronization unverified.`
      );
    log(`Verified: ${destination}@${expected}`);
  }
  return { ...result, copied: true };
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
