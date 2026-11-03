/**
 * @author Codex
 * @description Checks offline copy integrity and the exact credential-free two-file export contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/lib/skill-library/skill-snapshot'; export * from './src/lib/skill-library/skill-export';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { cacheSkill, readSkillCache, skillContentHash, skillArchive } = module.exports;
const candidate = {
  skillMarkdown: '---\nname: 中文查询\ndescription: 查询订单\n---\n查询',
  workflow: {
    schemaVersion: 1,
    inputs: [],
    allowedOrigins: ['https://example.com'],
    pages: [{ role: 'main', startUrl: 'https://example.com' }],
    execution: { maxModelCalls: 12 },
    evidence: [],
  },
};
const cache = cacheSkill(
  { skillId: '10000000-0000-4000-8000-000000000001', definitionHash: skillContentHash(candidate), candidate },
  123
);
test('browser copy has stable content identity and rejects edited or missing cached data', () => {
  assert.deepEqual(readSkillCache(structuredClone(cache)), cache);
  const changed = structuredClone(cache);
  changed.snapshot.candidate.skillMarkdown += 'changed';
  assert.throws(() => readSkillCache(changed), /SKILL_NO_BROWSER_COPY/);
  assert.throws(() => readSkillCache(undefined), /SKILL_NO_BROWSER_COPY/);
});
test('export includes only the two fixed definition files with exact Chinese content', () => {
  const files = unzipSync(skillArchive(cache));
  assert.deepEqual(Object.keys(files).sort(), ['SKILL.md', 'workflow.json']);
  assert.equal(strFromU8(files['SKILL.md']), candidate.skillMarkdown);
  assert.deepEqual(JSON.parse(strFromU8(files['workflow.json'])), candidate.workflow);
  assert.throws(() => skillArchive({ ...cache, apiKey: 'synthetic-private' }), /SKILL_NO_BROWSER_COPY/);
});
