/**
 * @author Codex
 * @description Checks that packaging inventory paths cannot copy unrelated or ambiguous resources into a release.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computerInventorySchema } from '../scripts/lib/resources/computer-manifest.mjs';

const paths = [
  'native/computer-supervisor.exe',
  'resources/computer/python.exe',
  'resources/computer/python314.dll',
  'resources/computer/python314.zip',
  'resources/computer/python314._pth',
  'resources/computer/.executor-asset.json',
  'resources/computer/product/server.py',
  'resources/computer/product/desktop.py',
  'resources/computer/product/schemas.json',
];
const inventory = {
  version: 1,
  files: paths.map((path) => ({ path, size: 1, sha256: 'a'.repeat(64) })),
};

test('packaging inventory requires the fixed resources and rejects traversal, foreign paths and case aliases', () => {
  assert.equal(computerInventorySchema.safeParse(inventory).success, true);
  for (const path of [
    '../escape',
    'resources/computer/../escape',
    'resources/computer/file:stream',
    'native/other.exe',
  ]) {
    assert.equal(
      computerInventorySchema.safeParse({
        ...inventory,
        files: [...inventory.files, { path, size: 1, sha256: 'a'.repeat(64) }],
      }).success,
      false
    );
  }
  assert.equal(
    computerInventorySchema.safeParse({ ...inventory, files: inventory.files.slice(1) }).success,
    false
  );
  assert.equal(
    computerInventorySchema.safeParse({
      ...inventory,
      files: [...inventory.files, { ...inventory.files[0], path: paths[0].toUpperCase() }],
    }).success,
    false
  );
});
