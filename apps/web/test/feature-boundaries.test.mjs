/**
 * @author Codex
 * @description Enforces component entrypoints, local Hook/tool ownership and acyclic feature dependencies.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const features = join(root, 'features');

/**
 * Lists checked-in source without executing UI or state initialization.
 */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    return item.isDirectory() ? files(path) : [path];
  });
}

/**
 * Resolves project-local imports, including index entries and dynamic imports.
 */
function target(file, specifier) {
  const path = specifier.startsWith('@/')
    ? join(root, specifier.slice(2))
    : resolve(dirname(file), specifier);
  return [
    path,
    path.replace(/\.js$/, '.ts'),
    path.replace(/\.js$/, '.tsx'),
    `${path}.ts`,
    `${path}.tsx`,
    join(path, 'index.ts'),
    join(path, 'index.tsx'),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/**
 * Visits declarations and executable expressions independently of formatting.
 */
function visit(node, action) {
  action(node);
  ts.forEachChild(node, (child) => visit(child, action));
}

test('feature directories contain component entries and directly owned hooks and utilities', () => {
  for (const entry of readdirSync(features, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), `${entry.name} must be a feature directory`);
    const directory = join(features, entry.name);
    assert.ok(existsSync(join(directory, 'index.ts')), `${entry.name} needs a public entrypoint`);
    for (const file of files(directory)) {
      const local = relative(directory, file).split(sep);
      if (['hooks', 'utils'].includes(local[0])) {
        assert.equal(local.length, 2, `${file} nests non-component files`);
        assert.ok(file.endsWith('.ts'), `${file} must contain non-JSX logic`);
      } else {
        assert.ok(file.endsWith('.tsx') || local.at(-1) === 'index.ts', `${file} is misplaced`);
      }
      if (local.at(-1) === 'index.ts') {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        for (const statement of source.statements) {
          assert.ok(
            ts.isExportDeclaration(statement) &&
              statement.moduleSpecifier &&
              statement.exportClause &&
              ts.isNamedExports(statement.exportClause),
            `${file} must contain explicit exports only`
          );
          const destination = target(file, statement.moduleSpecifier.text);
          assert.ok(destination?.endsWith('.tsx'), `${file} exports non-component implementation`);
        }
      }
    }
  }
});

test('feature consumers use public entries and common layers never depend on features', () => {
  const graph = new Map(readdirSync(features).map((name) => [name, new Set()]));
  const sourceFiles = new Set(files(root));
  for (const file of [...sourceFiles].filter((name) => /\.tsx?$/.test(name))) {
    const local = relative(root, file).split(sep);
    const feature = local[0] === 'features' ? local[1] : undefined;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    visit(source, (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        specifier = node.arguments[0];
      if (!specifier || !ts.isStringLiteralLike(specifier)) return;
      if (feature && specifier.text.startsWith('zustand') && ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          assert.ok(
            !bindings.elements.some((item) =>
              ['create', 'createStore', 'combine', 'persist'].includes((item.propertyName ?? item.name).text)
            ),
            `${file} defines feature-owned store infrastructure`
          );
        }
      }
      if (!specifier.text.startsWith('.') && !specifier.text.startsWith('@/')) return;
      const destination = target(file, specifier.text);
      assert.ok(destination, `${file}: unresolved local dependency ${specifier.text}`);
      assert.ok(
        sourceFiles.has(destination),
        `${file}: dependency path casing differs from disk: ${specifier.text}`
      );
      const parts = relative(root, destination).split(sep);
      if (feature && local[2] === 'utils') {
        assert.ok(
          !destination.endsWith('.tsx') && !parts.includes('hooks'),
          `${file} depends on presentation or Hook code`
        );
      }
      if (parts[0] !== 'features') return;
      assert.ok(
        !['components', 'hooks', 'utils', 'lib', 'stores', 'api', 'queries'].includes(local[0]),
        `${file} reverses the feature dependency direction`
      );
      if (feature === parts[1]) {
        assert.notEqual(destination, join(features, feature, 'index.ts'), `${file} imports its own barrel`);
        return;
      }
      assert.equal(
        destination,
        join(features, parts[1], 'index.ts'),
        `${file} accesses another feature's internals`
      );
      if (feature) graph.get(feature).add(parts[1]);
    });
  }
  /**
   * Rejects feature cycles rather than depending on import evaluation order.
   */
  function check(name, stack) {
    assert.ok(!stack.includes(name), `Feature cycle: ${[...stack, name].join(' -> ')}`);
    for (const next of graph.get(name)) check(next, [...stack, name]);
  }
  for (const name of graph.keys()) check(name, []);
});

test('infrastructure and global utilities keep React lifecycle wiring in hooks', () => {
  for (const layer of ['lib', 'utils']) {
    for (const file of files(join(root, layer)).filter((name) => name.endsWith('.ts'))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      visit(source, (node) => {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteralLike(specifier)) return;
        assert.ok(!/^(react|ahooks)(\/|$)/.test(specifier.text), `${file} imports React lifecycle code`);
        const destination = target(file, specifier.text);
        if (destination) {
          assert.notEqual(relative(root, destination).split(sep)[0], 'hooks', `${file} imports a Hook`);
        }
      });
    }
  }
  const entry = join(root, 'lib/shortcuts/index.ts');
  const source = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    assert.ok(
      ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause),
      'Shortcut entrypoint must explicitly re-export infrastructure without implementing initialization or Hooks'
    );
  }
});
