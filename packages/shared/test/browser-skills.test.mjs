/**
 * @author Codex
 * @description Regresses multilingual skill metadata, YAML parsing and specific value-free validation errors.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  browserSkillPackageSchema,
  browserSkillIssueMessages,
  browserSkillRequestSchema,
  browserSkillResponseSchema,
} from '../dist/protocol/browser-skills.js';
const workflow = {
  schemaVersion: 1,
  inputs: [{ name: 'orderNo', label: '订单编号', type: 'text', required: true }],
  allowedOrigins: ['https://example.com'],
  pages: [{ role: 'search', startUrl: 'https://example.com/search' }],
  execution: { maxModelCalls: 12 },
  evidence: [],
};

test('skill deletion accepts only authenticated request identities and a skill UUID, never paths', () => {
  const request = {
    type: 'skills.delete',
    requestId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    skillId: crypto.randomUUID(),
  };
  assert.equal(browserSkillRequestSchema.safeParse(request).success, true);
  assert.equal(browserSkillRequestSchema.safeParse({ ...request, skillId: '../outside' }).success, false);
  assert.equal(browserSkillRequestSchema.safeParse({ ...request, path: 'C:\\outside' }).success, false);
  assert.equal(
    browserSkillRequestSchema.safeParse({ ...request, installationId: crypto.randomUUID() }).success,
    false
  );
  assert.equal(
    browserSkillResponseSchema.safeParse({
      type: 'skills.result',
      requestId: request.requestId,
      connectionId: request.connectionId,
      value: { deleted: true },
    }).success,
    true
  );
});

test('choice packages preserve false states and reject invalid URLs, roles and duplicate identities without throwing', () => {
  const choice = {
    id: 'choice-action-1',
    ref: 'action-1',
    url: 'https://example.com/search',
    control: { role: 'checkbox', group: '通知', label: '接收通知', state: false },
  };
  const value = {
    ...candidate('name: 测试\ndescription: 测试'),
    workflow: { ...workflow, choices: [choice] },
  };
  assert.equal(browserSkillPackageSchema.parse(value).workflow.choices[0].control.state, false);
  for (const patch of [
    { url: 'not-a-url' },
    { url: 'https://outside.test/' },
    { control: { ...choice.control, state: ['wrong-type'] } },
  ]) {
    assert.equal(
      browserSkillPackageSchema.safeParse({
        ...value,
        workflow: { ...workflow, choices: [{ ...choice, ...patch }] },
      }).success,
      false
    );
  }
  assert.equal(
    browserSkillPackageSchema.safeParse({ ...value, workflow: { ...workflow, choices: [choice, choice] } })
      .success,
    false
  );
});
/**
 * Builds synthetic metadata with no user recording content.
 */
function candidate(metadata, body = '查询 {{orderNo}}') {
  return { skillMarkdown: '---\n' + metadata + '\n---\n' + body, workflow };
}
/**
 * Returns only codes from a deliberately invalid candidate.
 */
function codes(value) {
  const result = browserSkillPackageSchema.safeParse(value);
  assert.equal(result.success, false);
  return result.error.issues.map((issue) => issue.message);
}
test('Chinese, mixed-language and quoted display names and block descriptions are accepted', () => {
  for (const metadata of [
    'name: 订单查询\ndescription: 查询订单。',
    'name: Example 平台订单查询\ndescription: 查询订单。',
    'name: "订单查询：客户服务"\ndescription: "查询指定订单"',
    "name: '订单查询'\ndescription: |\n  查询订单。\n  只返回页面结果。",
    'name: order-query\ndescription: 查询',
    'name: "技能：🦑"\ndescription: >\n  查询订单\n  并显示结果',
  ]) {
    assert.equal(browserSkillPackageSchema.safeParse(candidate(metadata)).success, true, metadata);
    assert.equal(
      browserSkillPackageSchema.safeParse({
        ...candidate(metadata),
        skillMarkdown: candidate(metadata).skillMarkdown.replaceAll('\n', '\r\n'),
      }).success,
      true
    );
  }
});
test('missing metadata, name, description and references have distinct actionable codes', () => {
  assert.deepEqual(codes({ ...candidate('name: 查询\ndescription: 查询'), skillMarkdown: '正文' }), [
    'SKILL_METADATA_MISSING',
  ]);
  for (const name of ['""', '123', '[]', '"第一行\\n第二行"', '"' + '名'.repeat(121) + '"'])
    assert.ok(codes(candidate('name: ' + name + '\ndescription: 查询')).includes('SKILL_METADATA_NAME'));
  assert.ok(codes(candidate('name: 查询\ndescription: ""')).includes('SKILL_METADATA_DESCRIPTION'));
  assert.ok(
    codes(candidate('name: 查询\ndescription: 查询', '查询 {{missing}}')).includes('SKILL_UNDECLARED_INPUT')
  );
  for (const code of [
    'SKILL_METADATA_MISSING',
    'SKILL_METADATA_NAME',
    'SKILL_METADATA_DESCRIPTION',
    'SKILL_UNDECLARED_INPUT',
  ])
    assert.ok(browserSkillIssueMessages[code]);
});
test('invalid YAML, duplicate keys and aliases fail safely without echoing parser content', () => {
  for (const metadata of [
    'name: [broken\ndescription: private-marker',
    'name: 查询\nname: 重复\ndescription: 查询',
    'name: &name 查询\ndescription: *name',
    '- name: 查询',
    'name: !unknown private-marker\ndescription: 查询',
  ]) {
    const issues = codes(candidate(metadata));
    assert.ok(issues.includes('SKILL_METADATA_YAML'));
    assert.equal(JSON.stringify(issues).includes('private-marker'), false);
  }
});
test('schema exposes display-name contract and keeps cross-file and origin restrictions', () => {
  const schema = z.toJSONSchema(browserSkillPackageSchema);
  assert.match(schema.properties.skillMarkdown.description, /中文/);
  assert.match(schema.properties.skillMarkdown.description, /120/);
  const value = candidate('name: 查询\ndescription: 查询');
  assert.ok(
    codes({ ...value, workflow: { ...workflow, inputs: [...workflow.inputs, ...workflow.inputs] } }).includes(
      'SKILL_DUPLICATE_INPUT'
    )
  );
  assert.ok(
    codes({
      ...value,
      workflow: { ...workflow, pages: [{ role: 'search', startUrl: 'https://elsewhere.example/search' }] },
    }).includes('SKILL_PAGE_OUTSIDE_ORIGINS')
  );
  assert.doesNotThrow(() =>
    browserSkillPackageSchema.safeParse({
      ...value,
      workflow: { ...workflow, allowedOrigins: ['not-a-url'] },
    })
  );
});
