/**
 * @author Codex
 * @description Guards state-domain entrypoints without prescribing internal file counts or creating store instances.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const storesRoot = join(sourceRoot, 'stores');

/**
 * Enumerates sources without importing modules or initializing browser storage.
 */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/**
 * Resolves source aliases and relative paths, including explicit TypeScript extensions.
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
 * Inspects static imports, dynamic imports and re-exports through the syntax tree.
 */
function visit(node, action) {
  action(node);
  ts.forEachChild(node, (child) => visit(child, action));
}

test('state domains expose explicit entries and choose utilities without duplicate containers', () => {
  for (const domain of readdirSync(storesRoot, { withFileTypes: true })) {
    assert.ok(domain.isDirectory(), `${domain.name} must belong to a state-domain directory`);
    assert.match(domain.name, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    const directory = join(storesRoot, domain.name);
    const entry = join(directory, 'index.ts');
    assert.ok(existsSync(entry), `${domain.name} needs a public entrypoint`);
    assert.ok(
      !(existsSync(join(directory, 'utils.ts')) && existsSync(join(directory, 'utils'))),
      `${domain.name} must choose utils.ts or utils/`
    );
    const source = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      assert.ok(
        ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause),
        `${entry} must contain explicit re-exports only`
      );
      const target = destination(entry, statement.moduleSpecifier.text);
      assert.ok(target?.startsWith(directory + sep), `${entry} must expose its own domain`);
    }
  }
});

test('Session keeps explicit root roles and internal groups without extra entrypoints', () => {
  const directory = join(storesRoot, 'session');
  const roles = new Set(['index.ts', 'store.ts', 'type.ts', 'registry.ts']);
  const groups = new Set(['reducers', 'utils']);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const allowed = entry.isDirectory() ? groups : roles;
    assert.ok(allowed.has(entry.name), `Session root has an unclassified entry: ${entry.name}`);
  }
  for (const file of files(directory)) {
    if (dirname(file) === directory) continue;
    assert.ok(!file.endsWith(`${sep}index.ts`), `${file} adds an unnecessary internal entrypoint`);
  }
});

test('application consumers access state domains through public entries', () => {
  for (const file of files(sourceRoot).filter((path) => /\.tsx?$/.test(path))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    visit(source, (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) return;
      const target = destination(file, specifier.text);
      if (!target?.startsWith(storesRoot + sep)) return;
      const domain = relative(storesRoot, target).split(sep)[0];
      const directory = join(storesRoot, domain);
      const entry = join(directory, 'index.ts');
      if (file.startsWith(directory + sep)) {
        assert.notEqual(target, entry, `${file} must not import its own public entry`);
      } else {
        assert.equal(target, entry, `${file} bypasses the ${domain} public entry`);
      }
    });
  }
});
