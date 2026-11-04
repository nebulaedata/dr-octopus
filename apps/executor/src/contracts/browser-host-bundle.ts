/**
 * @author Codex
 * @description Defines the complete serialized Host inventory shared by build, maintenance and Native transport; bundle IDs hash JSON.stringify of this parsed contract.
 */
import { z } from 'zod';
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const hostBundlePaths = [
  'native/browser-launcher.exe',
  'native/file-commit.node',
  'bridge/native-host.cjs',
  'bridge/LICENSES.txt',
  'resources/node/node.exe',
  'resources/node/LICENSE',
  'setup/browser-host.cjs',
  'setup/browser-registry.ps1',
  'setup/register-browser-host.ps1',
] as const;
export const hostBundleSchema = z.strictObject({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .max(30),
  protocolVersion: z.number().int().positive(),
  hostName: z.string().regex(/^com\.octopus\.executor\.browser(?:\.dev_[a-f0-9]{16})?$/),
  origins: z
    .array(z.string().regex(/^chrome-extension:\/\/[a-p]{32}\/$/))
    .min(1)
    .max(3),
  files: z.record(z.enum(hostBundlePaths), digestSchema),
});
