/**
 * @author Codex
 * @description Guards business module roles, public imports, connection ownership, and acyclic dependencies.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/modules/', import.meta.url));

/**
 * Visits syntax recursively without coupling the guard to source formatting.
 */
function visit(node, check) {
  check(node);
  ts.forEachChild(node, (child) => visit(child, check));
}

test('every business module has one entrypoint, cohesive roles, and public cross-module imports', () => {
  const dependencies = new Map();
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    assert.equal(directory.isDirectory(), true, `${directory.name} is not a business directory`);
    const name = directory.name;
    dependencies.set(name, new Set());
    const files = readdirSync(join(root, name));
    assert.ok(existsSync(join(root, name, 'index.ts')), `${name} must have a module entrypoint`);
    const allowed = new Set([
      'index.ts',
      'workers',
      ...['controller', 'service', 'repository', 'dto', 'utils'].map((role) => `${name}.${role}.ts`),
    ]);
    for (const file of files) {
      assert.ok(allowed.has(file), `${name}/${file} is outside the role allowlist`);
      if (!file.endsWith('.ts')) {
        continue;
      }
      const source = ts.createSourceFile(
        file,
        readFileSync(join(root, name, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      if (file === 'index.ts') {
        assert.ok(source.statements.some(ts.isExportAssignment), `${name} must export its plugin`);
      }
      visit(source, (node) => {
        if (ts.isConditionalExpression(node)) {
          for (const branch of [node.whenTrue, node.whenFalse]) {
            visit(branch, (child) =>
              assert.equal(ts.isConditionalExpression(child), false, `${name}/${file} nests a ternary`)
            );
          }
        }
        if (ts.isImportDeclaration(node)) {
          const imported = node.moduleSpecifier.text;
          const sibling = imported.match(/^\.\.\/([^/.][^/]*)\//)?.[1];
          if (sibling) {
            assert.equal(imported, `../${sibling}/index.js`, `${name}/${file} imports a private module file`);
            dependencies.get(name).add(sibling);
          }
          if (file.endsWith('.service.ts') && imported === 'fastify') {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) {
              assert.ok(
                !bindings.elements.some(
                  (item) => (item.propertyName ?? item.name).text === 'FastifyInstance'
                ),
                `${name} must receive explicit service dependencies`
              );
            }
          }
          assert.ok(
            !['better-sqlite3', 'drizzle-orm/better-sqlite3'].includes(imported),
            `${name}/${file} imports a connection initializer`
          );
          if (imported.endsWith('/db/client.js')) {
            assert.equal(
              node.importClause?.isTypeOnly,
              true,
              `${name}/${file} must consume an injected database`
            );
          }
        }
      });
    }
  }
  /**
   * Rejects cycles in the actual public module import graph.
   */
  function check(name, active, complete) {
    assert.ok(!active.has(name), `Cyclic module dependency: ${[...active, name].join(' -> ')}`);
    if (complete.has(name)) {
      return;
    }
    assert.ok(dependencies.has(name), `Missing module ${name}`);
    active.add(name);
    for (const dependency of dependencies.get(name)) {
      check(dependency, active, complete);
    }
    active.delete(name);
    complete.add(name);
  }
  const complete = new Set();
  for (const name of dependencies.keys()) {
    check(name, new Set(), complete);
  }
});
