/**
 * @author Codex
 * @description Verifies skill recognition, independent rendering and restoration without altering ordinary read records.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';
import { projectSkillRead, projectSkillCommand } from '../src/features/session/utils/skill-projection.ts';
import { SkillToolRenderer } from '../src/features/session/ToolRenderers/CustomToolRenderers/SkillToolRenderer.tsx';
import { projectPersistedTranscript } from '../src/stores/session/utils/normalizer.ts';

const path = 'C:/agent/skills/imagegen/SKILL.md';

test('skill reads select a dedicated renderer for Windows, POSIX and grouped skill paths', () => {
  for (const path of [
    'C:\\agent\\skills\\imagegen\\SKILL.md',
    '/agent/skills/imagegen/SKILL.md',
    '.agents/skills/media/imagegen/SKILL.md',
  ]) {
    const tool = { name: 'read', arguments: { path } };
    assert.deepEqual(projectSkillRead(tool), { name: 'imagegen', path });
    const renderer = resolveToolRenderer('read', tool.arguments);
    assert.equal(renderer.component, SkillToolRenderer);
    assert.equal(
      renderer.getLabel(tool, (_key, fallback) => fallback),
      'Load skill'
    );
    assert.equal(renderer.summarize(tool), 'imagegen');
  }
  for (const path of [
    undefined,
    null,
    1,
    '/repo/SKILL.md',
    'skills/SKILL.md',
    'skills/imagegen/references/api.md',
    'skills/imagegen/SKILL.md.bak',
  ]) {
    assert.equal(resolveToolRenderer('read', { path }).component.name, 'ReadToolRenderer');
  }
  assert.equal(projectSkillRead({ name: 'write', arguments: { path } }), undefined);
  assert.equal(resolveToolRenderer('read').component.name, 'ReadToolRenderer');
});

test('restored Pi skill reads retain arguments, errors and tool identity for the same selector', () => {
  const transcript = projectPersistedTranscript([
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'skill-read', name: 'read', arguments: { path } }],
    },
    {
      role: 'toolResult',
      toolCallId: 'skill-read',
      toolName: 'read',
      isError: true,
      content: [{ type: 'text', text: 'File not found' }],
    },
  ]);
  const tool = transcript.tools.find((tool) => tool.id === 'skill-read');
  assert.equal(tool.name, 'read');
  assert.equal(tool.status, 'error');
  assert.equal(resolveToolRenderer(tool.name, tool.arguments).component, SkillToolRenderer);
  assert.equal(tool.content[0].text, 'File not found');
});

test('expanded skill commands preserve instructions and prompt while rejecting malformed envelopes', () => {
  const block = '<skill name="imagegen" location="' + path + '">\nInstructions\n</skill>';
  assert.deepEqual(projectSkillCommand(block + '\n\nMake a cat'), {
    name: 'imagegen',
    path,
    instructions: 'Instructions',
    prompt: 'Make a cat',
  });
  assert.equal(projectSkillCommand(block).prompt, '');
  assert.equal(projectSkillCommand(block.replace(/\n/g, '\r\n')).instructions, 'Instructions');
  for (const text of [
    '/skill:imagegen cat',
    'prefix ' + block,
    block + ' trailing',
    '<skill name="imagegen">Instructions</skill>',
  ]) {
    assert.equal(projectSkillCommand(text), undefined);
  }
});

test('skill rendering keeps errors and read truncation diagnostics visible', (context) => {
  const previous = globalThis.React;
  globalThis.React = React;
  context.after(() => {
    globalThis.React = previous;
  });
  const html = renderToStaticMarkup(
    createElement(SkillToolRenderer, {
      tool: {
        name: 'read',
        arguments: { path },
        status: 'error',
        content: [{ type: 'text', text: 'File not found' }],
        details: { truncation: { truncated: true, totalLines: 200, outputLines: 10 } },
      },
    })
  );
  assert.match(html, /Skill instructions/);
  assert.match(html, /File not found/);
  assert.match(html, /Showing.*lines/);
});
