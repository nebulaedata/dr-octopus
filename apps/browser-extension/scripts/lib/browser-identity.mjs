/**
 * @author Codex
 * @description Resolves public browser identities once at build time without exporting unrelated environment values or changing process state.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { z } from 'zod';
import { bridgeHelloSchema, bridgeVersion } from '@octopus/shared/protocol/browser-bridge';
const extensionId = z.string().regex(/^[a-p]{32}$/);
const configurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sideload: z.strictObject({ extensionId, publicKey: z.string().min(50).max(4096) }),
  stores: z.strictObject({
    chromeExtensionId: extensionId,
    edgeExtensionId: extensionId,
  }),
});
const snapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sideloadExtensionId: extensionId,
  sideloadPublicKey: z.string().min(50).max(4096),
  chromeExtensionId: extensionId,
  edgeExtensionId: extensionId,
  allowedOrigins: z
    .array(z.string().regex(/^chrome-extension:\/\/[a-p]{32}\/$/))
    .min(1)
    .max(3),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
/**
 * Derives the sideload ID from a canonical RSA SPKI public key; a key never grants Native Host authority by itself.
 * @throws Invalid public keys fail the build before any generated output is written.
 */
export function extensionIdFromKey(key) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.toString('base64') !== key) {
    throw new Error('Browser sideload public key must be canonical base64.');
  }
  if (createPublicKey({ key: bytes, format: 'der', type: 'spki' }).asymmetricKeyType !== 'rsa') {
    throw new Error('Browser sideload public key must be RSA SPKI.');
  }
  return createHash('sha256')
    .update(bytes)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + Number.parseInt(value, 16)));
}
/**
 * Creates the stable payload whose digest binds every consumer to the same resolved build inputs.
 */
function payload(identity) {
  return {
    schemaVersion: identity.schemaVersion,
    sideloadExtensionId: identity.sideloadExtensionId,
    sideloadPublicKey: identity.sideloadPublicKey,
    chromeExtensionId: identity.chromeExtensionId,
    edgeExtensionId: identity.edgeExtensionId,
    allowedOrigins: [...identity.allowedOrigins],
  };
}
/**
 * Validates an emitted public snapshot, including its exact origin set, key and fingerprint.
 */
export function parseBrowserIdentity(value) {
  const identity = snapshotSchema.parse(value);
  if (extensionIdFromKey(identity.sideloadPublicKey) !== identity.sideloadExtensionId) {
    throw new Error('Browser sideload public key and extension ID differ.');
  }
  const origins = [
    ...new Set([identity.sideloadExtensionId, identity.chromeExtensionId, identity.edgeExtensionId]),
  ]
    .sort()
    .map((id) => `chrome-extension://${id}/`);
  if (JSON.stringify(origins) !== JSON.stringify(identity.allowedOrigins)) {
    throw new Error('Browser identity origin set is inconsistent.');
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(payload(identity)))
    .digest('hex');
  if (fingerprint !== identity.fingerprint) {
    throw new Error('Browser identity fingerprint differs from its public payload.');
  }
  return Object.freeze({ ...identity, allowedOrigins: Object.freeze(identity.allowedOrigins) });
}
/**
 * Resolves the complete official identity policy exclusively from versioned configuration.
 * Ignores plugin packaging mode and product versions so compatible releases share the same policy.
 */
export function resolveBrowserIdentity(configuration) {
  const config = configurationSchema.parse(configuration);
  const { chromeExtensionId, edgeExtensionId } = config.stores;
  const identity = payload({
    schemaVersion: 1,
    sideloadExtensionId: config.sideload.extensionId,
    sideloadPublicKey: config.sideload.publicKey,
    chromeExtensionId,
    edgeExtensionId,
    allowedOrigins: [...new Set([config.sideload.extensionId, chromeExtensionId, edgeExtensionId])]
      .sort()
      .map((id) => `chrome-extension://${id}/`),
  });
  return parseBrowserIdentity({
    ...identity,
    fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  });
}
/**
 * Reads only the versioned official identities; client builds never open .env or inspect environment IDs.
 */
export function loadBrowserIdentity({ configurationPath } = {}) {
  const path = configurationPath ?? fileURLToPath(new URL('../../browser-identity.json', import.meta.url));
  return resolveBrowserIdentity(JSON.parse(readFileSync(path, 'utf8')));
}
const extensionBuildSchema = z.strictObject({
  identity: z.unknown(),
  profile: z.enum(['sideload', 'store']),
  protocolVersion: z.number().int().min(1).max(1000),
  extensionVersion: bridgeHelloSchema.shape.extensionVersion,
});
/**
 * Validates extension delivery metadata independently of the client's policy and product version.
 */
export function parseBrowserExtensionBuild(value) {
  const build = extensionBuildSchema.parse(value);
  return Object.freeze({ ...build, identity: parseBrowserIdentity(build.identity) });
}
/**
 * Resolves the plugin artifact mode independently from its mandatory official identity policy.
 */
export function resolveBrowserExtensionBuild(configuration, profile, extensionVersion) {
  if (profile !== 'sideload' && profile !== 'store') {
    throw new Error('BROWSER_IDENTITY_PROFILE must be sideload or store.');
  }
  return parseBrowserExtensionBuild({
    identity: resolveBrowserIdentity(configuration),
    profile,
    protocolVersion: bridgeVersion,
    extensionVersion,
  });
}
/**
 * Reads the plugin's own version and mode without imposing either on an independently built client.
 */
export function loadBrowserExtensionBuild({
  configurationPath,
  environmentPath,
  environment = process.env,
} = {}) {
  const identity = loadBrowserIdentity({ configurationPath });
  const path = environmentPath ?? fileURLToPath(new URL('../../../../.env', import.meta.url));
  let fileProfile;
  try {
    fileProfile = parse(readFileSync(path)).BROWSER_IDENTITY_PROFILE;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
  const profile = environment.BROWSER_IDENTITY_PROFILE ?? fileProfile ?? 'sideload';
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  return parseBrowserExtensionBuild({
    identity,
    profile,
    protocolVersion: bridgeVersion,
    extensionVersion: version,
  });
}
