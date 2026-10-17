/**
 * @author Codex
 * @description Constrains the build and packaging Computer inventory; it is never loaded during backend startup.
 */
import { z } from 'zod';
const asset = z.strictObject({ url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const computerManifestSchema = z.strictObject({
  python: asset.extend({ version: z.literal('3.14.0') }),
  windowsMcp: z.strictObject({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
  }),
  wheels: z
    .array(
      asset.extend({
        name: z.string(),
        version: z.string(),
        filename: z.string().regex(/^[A-Za-z0-9_.+-]+\.whl$/),
      })
    )
    .min(1)
    .max(128),
});

const required = [
  'native/computer-supervisor.exe',
  'resources/computer/python.exe',
  'resources/computer/python314.dll',
  'resources/computer/python314.zip',
  'resources/computer/python314._pth',
  'resources/computer/.executor-asset.json',
  'resources/computer/executor.toml',
  'resources/computer/sitecustomize.py',
  'resources/computer/Lib/site-packages/comtypes/gen/__init__.py',
  'resources/computer/Lib/site-packages/windows_mcp/__main__.py',
];
const fileSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(1024)
    .refine(
      (path) =>
        !/[\\:]/.test(path) &&
        [...path].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) &&
        !path.split('/').some((part) => !part || part === '.' || part === '..') &&
        (path === 'native/computer-supervisor.exe' || path.startsWith('resources/computer/'))
    ),
  size: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const computerInventorySchema = z
  .strictObject({ version: z.literal(1), files: z.array(fileSchema).min(required.length).max(10000) })
  .refine(
    (value) =>
      new Set(value.files.map((file) => file.path.toLowerCase())).size === value.files.length &&
      required.every((path) => value.files.some((file) => file.path === path)) &&
      value.files.reduce((sum, file) => sum + file.size, 0) <= 512 * 1024 * 1024
  );
