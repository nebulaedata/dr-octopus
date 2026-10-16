/**
 * @author Codex
 * @description Emits one browser identity into native, JavaScript and setup outputs and rejects mixed or stale packaging inputs.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
import {
  extensionIdFromKey,
  parseBrowserIdentity,
  parseBrowserExtensionBuild,
} from '../../../../browser-extension/scripts/lib/browser-identity.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const artifactPaths = [
  'native/browser-launcher.exe',
  'bridge/native-host.cjs',
  'runtime/index.cjs',
  'setup/register-browser-host.ps1',
];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const builtSnapshotSchema = z.strictObject({
  identity: z.unknown(),
  protocolVersion: z.number().int().min(1).max(1000),
  artifacts: z.strictObject(Object.fromEntries(artifactPaths.map((path) => [path, digest]))),
});
/**
 * Serializes immutable origins into a generated module; packaged code never reads a mutable .env.
 */
export function browserIdentityModule(identity) {
  return `/**
 * @author Codex
 * @description Contains the browser identity resolved and validated for this build; do not edit generated output.
 */
export const browserIdentity = Object.freeze(${JSON.stringify(identity, null, 2)} as const);
export const browserAllowedOrigins: readonly string[] = Object.freeze([...browserIdentity.allowedOrigins]);
/**
 * Accepts only exact origins compiled into this product, rejecting arrays and unknown callers.
 */
export function isBrowserOriginAllowed(origin: unknown): origin is string {
  return typeof origin === 'string' && browserAllowedOrigins.includes(origin);
}
`.replace(/\n/g, '\r\n');
}
/**
 * Generates the native header, runtime module and setup script from the same validated snapshot.
 * Source setup markers must occur exactly once; a changed template fails instead of retaining a stale ID.
 */
export async function prepareBrowserIdentity(identity) {
  for (const directory of ['build/native', 'build/setup']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await writeFile(join(root, 'build/browser-identity.ts'), browserIdentityModule(identity));
  const header = [
    '/**',
    ' * @author Codex',
    ' * @description Contains the exact browser origins for this native build; do not edit generated output.',
    ' */',
    '#pragma once',
    'inline constexpr const wchar_t* kBrowserAllowedOrigins[] = {',
    ...identity.allowedOrigins.map((origin) => `  L"${origin}",`),
    '};',
    '',
  ].join('\r\n');
  await writeFile(join(root, 'build/native/browser-identity.h'), header);
  let registration = await readFile(join(root, 'src/installation/windows/register-browser-host.ps1'), 'utf8');
  const marker = "'__OCTOPUS_BROWSER_ALLOWED_ORIGINS__'";
  if (registration.split(marker).length !== 2) {
    throw new Error('Browser registration template marker is missing or duplicated.');
  }
  registration = registration.replace(
    marker,
    identity.allowedOrigins.map((origin) => "'" + origin + "'").join(', ')
  );
  await writeFile(join(root, 'build/setup/register-browser-host.ps1'), registration);
}
/**
 * Writes the completed identity record only after all policy consumers were successfully compiled and copied.
 */
export async function writeBuiltBrowserIdentity(identity) {
  const artifacts = {};
  for (const path of artifactPaths) {
    artifacts[path] = createHash('sha256')
      .update(await readFile(join(root, 'dist', path)))
      .digest('hex');
  }
  await writeFile(
    join(root, 'dist/browser-identity.json'),
    JSON.stringify({ identity, protocolVersion: bridgeVersion, artifacts }, null, 2)
  );
}
/**
 * Verifies the client alone without loading plugin outputs or depending on their product version or mode.
 */
export async function verifyBuiltBrowserIdentity(identity, executor = join(root, 'dist')) {
  const snapshot = builtSnapshotSchema.parse(
    JSON.parse(await readFile(join(executor, 'browser-identity.json'), 'utf8'))
  );
  if (parseBrowserIdentity(snapshot.identity).fingerprint !== identity.fingerprint) {
    throw new Error('Executor browser identity is stale; rebuild with the current configuration.');
  }
  if (snapshot.protocolVersion !== bridgeVersion) {
    throw new Error('Executor browser protocol is stale; rebuild the client.');
  }
  for (const path of artifactPaths) {
    const actual = createHash('sha256')
      .update(await readFile(join(executor, path)))
      .digest('hex');
    if (actual !== snapshot.artifacts[path]) {
      throw new Error(`Browser identity consumer changed after its completed build: ${path}`);
    }
  }
  return { identity: parseBrowserIdentity(snapshot.identity), protocolVersion: snapshot.protocolVersion };
}
/**
 * Checks only the selected bundled channels and protocol; independent release versions and modes may differ.
 */
export async function verifyBundledBrowserExtensions(
  client,
  extensions = join(root, '../browser-extension/.output')
) {
  for (const flavor of ['chrome', 'edge']) {
    const directory = join(extensions, `${flavor}-mv3`);
    const emitted = parseBrowserExtensionBuild(
      JSON.parse(await readFile(join(directory, 'browser-identity.json'), 'utf8'))
    );
    if (emitted.protocolVersion !== client.protocolVersion) {
      throw new Error(flavor + ' bundled extension protocol is incompatible with Executor.');
    }
    const manifest = z
      .object({ version: z.string(), key: z.string().optional() })
      .parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
    if (manifest.version !== emitted.extensionVersion) {
      throw new Error(flavor + ' extension version differs from its completed build metadata.');
    }
    const extensionId =
      emitted.profile === 'sideload'
        ? emitted.identity.sideloadExtensionId
        : flavor === 'chrome'
          ? emitted.identity.chromeExtensionId
          : emitted.identity.edgeExtensionId;
    if (!client.identity.allowedOrigins.includes('chrome-extension://' + extensionId + '/')) {
      throw new Error(flavor + ' bundled extension identity is not allowed by Executor.');
    }
    if (emitted.profile === 'sideload') {
      if (
        typeof manifest.key !== 'string' ||
        extensionIdFromKey(manifest.key) !== emitted.identity.sideloadExtensionId
      ) {
        throw new Error(`${flavor} sideload manifest key differs from the approved identity.`);
      }
    } else if (manifest.key !== undefined) {
      throw new Error('Store bundles must not carry the sideload manifest key.');
    }
  }
}
