/**
 * @author Codex
 * @description Guards the Header chat entry across active Session and agent-home navigation states.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('chat stays enabled and falls back to the current workspace agent home without a Session', () => {
  const header = readFileSync(new URL('../src/features/layout/Header.tsx', import.meta.url), 'utf8');

  const source = ts.createSourceFile('Header.tsx', header, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const menu = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name.text === 'WorkbenchNavMenu'
  );
  const statements = menu.body.statements;
  const start = statements.findIndex(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((item) => item.name.getText(source) === 'isSessionRoute')
  );
  const end = statements.findIndex(ts.isReturnStatement);
  let chat;
  /**
   * Reads the actual declarative Chat item without depending on control-flow spelling.
   */
  function visit(node) {
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === 'id' &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === 'chat'
      )
    ) {
      chat = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(menu);
  assert.ok(chat);
  assert.ok(!chat.properties.some((property) => property.name?.getText(source) === 'disabled'));
  const active = chat.properties
    .find((property) => property.name?.getText(source) === 'active')
    .initializer.getText(source);
  const code = ts.transpileModule(
    `function target(session, workspaceId, pathname) { ${statements
      .slice(start, end)
      .map((node) => node.getText(source))
      .join('\n')} return {to: chatTo, params: chatParams, active: ${active}}; }`,
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }
  ).outputText;
  const target = vm.runInNewContext(`${code}; target`);
  assert.equal(target(undefined, undefined, '/').to, '/');
  assert.equal(target(undefined, 'w', '/workspaces/w').to, '/workspaces/$workspaceId');
  const session = { id: 's', workspaceId: 'w' };
  const selected = target(session, 'w', '/workspaces/w/sessions/s');
  assert.equal(selected.to, '/workspaces/$workspaceId/sessions/$sessionId');
  assert.equal(selected.params.sessionId, 's');
  assert.equal(selected.params.workspaceId, 'w');
  assert.equal(selected.active, true);
  assert.equal(target(undefined, 'w', '/workspaces/w').active, true);
  assert.equal(target(undefined, 'w', '/schedules').active, false);
});
