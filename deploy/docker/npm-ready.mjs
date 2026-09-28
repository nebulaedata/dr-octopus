/**
 * @author Codex
 * @description Waits for an exact public npm version and its tarball before starting a Docker build.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseIdentity } from './release.mjs';

/**
 * Retries temporary registry failures; authentication and malformed metadata fail immediately.
 * The deadline includes request time, so delayed publication cannot occupy a runner indefinitely.
 */
export async function waitForNpmVersion(
  version,
  {
    request = fetch,
    pause = sleep,
    now = Date.now,
    timeoutMs = 900_000,
    intervalMs = 60_000,
    log = console.log,
  } = {}
) {
  releaseIdentity(`v${version}`);
  const deadline = now() + timeoutMs;
  const metadataUrl = `https://registry.npmjs.org/dr-octopus/${encodeURIComponent(version)}`;

  /**
   * Treats missing resources, rate limits, server errors and transport failures as temporarily unavailable.
   */
  async function available(url, method = 'GET') {
    if (now() >= deadline) return null;
    let response;
    try {
      response = await request(url, {
        method,
        signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - now()))),
      });
    } catch (error) {
      log(`npm request failed: ${error.message}`);
      return null;
    }
    if (response.status === 404 || response.status === 429 || response.status >= 500) return null;
    if (!response.ok) throw new Error(`Public npm lookup failed: HTTP ${response.status} (${url})`);
    return response;
  }

  while (now() < deadline) {
    const response = await available(metadataUrl);
    let body;
    if (response) {
      try {
        body = await response.text();
      } catch (error) {
        log(`npm metadata download failed: ${error.message}`);
      }
    }
    if (body !== undefined) {
      // Retry transport failures above, but reject a fully downloaded malformed document immediately.
      const metadata = JSON.parse(body);
      if (metadata.name !== 'dr-octopus' || metadata.version !== version)
        throw new Error('npm metadata does not match the requested package and version.');
      const tarball = new URL(metadata.dist?.tarball);
      if (tarball.origin !== 'https://registry.npmjs.org')
        throw new Error('Expected a public npm registry tarball.');
      if (await available(tarball.href, 'HEAD')) {
        log(`dr-octopus@${version} and its tarball are publicly available.`);
        return;
      }
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    log(
      `Waiting for dr-octopus@${version}; retrying in ${Math.ceil(Math.min(intervalMs, remaining) / 1000)}s.`
    );
    await pause(Math.min(intervalMs, remaining));
  }
  throw new Error(
    `dr-octopus@${version} is not publicly downloadable after ${timeoutMs / 60_000} minutes. ` +
      'Once npm makes it available, re-run the failed Actions job or use Run workflow with the same tag ' +
      'and image revision. Do not republish a package already accepted by npm.'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  waitForNpmVersion(process.env.NPM_VERSION).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
