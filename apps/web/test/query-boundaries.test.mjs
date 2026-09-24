/**
 * @author Codex
 * @description Guards Query layer roles, internal helpers and acyclic runtime dependencies without initializing clients.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const queriesRoot = join(sourceRoot, 'queries');
const coreRoot = join(queriesRoot, 'core');
const utilitiesRoot = join(queriesRoot, 'utils');

/**
 * Enumerates sources without evaluating their module-level initialization.
 */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/**
 * Resolves aliases and relative imports to existing source files.
 */
function destination(file, specifier) {
  let path;
  if (specifier.startsWith('@/')) path = join(sourceRoot, specifier.slice(2));
  else if (specifier.startsWith('.')) path = resolve(dirname(file), specifier);
  else return undefined;
  return [path, `${path}.ts`, `${path}.tsx`, join(path, 'index.ts')].find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile()
  );
}

/**
 * Visits static and dynamic dependencies independently of source formatting.
 */
function visit(node, action) {
  action(node);
  ts.forEachChild(node, (child) => visit(child, action));
}

test('Query root separates public query modules, core infrastructure and internal helpers', () => {
  for (const entry of readdirSync(queriesRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) assert.ok(['core', 'utils'].includes(entry.name));
    else assert.match(entry.name, /^[a-z][a-z0-9-]*-queries\.ts$/);
  }
  assert.deepEqual(readdirSync(coreRoot).sort(), ['query-client.ts', 'query-keys.ts']);
  for (const file of files(utilitiesRoot)) {
    assert.ok(
      file.endsWith('.ts') && !file.endsWith(`${sep}index.ts`),
      `${file} adds an internal barrel or UI`
    );
  }
});

test('Query helpers have no external consumers or React imports and Query runtime dependencies are acyclic', () => {
  const graph = new Map(files(queriesRoot).map((file) => [file, new Set()]));
  for (const file of files(sourceRoot).filter((path) => /\.tsx?$/.test(path))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    visit(source, (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) return;
      if (file.startsWith(utilitiesRoot + sep)) {
        assert.ok(!/^react(?:\/|$)/.test(specifier.text), `${file} imports React into a Query helper`);
      }
      const target = destination(file, specifier.text);
      if (!target) return;
      if (file.startsWith(coreRoot + sep) && target.startsWith(queriesRoot + sep)) {
        assert.ok(target.startsWith(coreRoot + sep), `${file} reverses the Query core dependency direction`);
      }
      if (target.startsWith(utilitiesRoot + sep)) {
        assert.ok(file.startsWith(queriesRoot + sep), `${file} bypasses the Query public modules`);
      }
      if (!graph.has(file) || !graph.has(target)) return;
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
      graph.get(file).add(target);
    });
  }
  /**
   * Rejects cycles without relying on module initialization order.
   */
  function check(file, stack) {
    assert.ok(!stack.includes(file), `Query dependency cycle: ${[...stack, file].join(' -> ')}`);
    for (const next of graph.get(file)) check(next, [...stack, file]);
  }
  for (const file of graph.keys()) check(file, []);
});
