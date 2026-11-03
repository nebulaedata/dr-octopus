/**
 * @author Codex
 * @description Verifies in-place model probing, top Alert feedback and explicit credential reuse through real extension APIs.
 */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { join } from 'node:path';
/* global chrome */

/**
 * Checks visibility controls preserve the unsaved key and caret without submitting or persisting the form.
 */
export async function verifyKeyVisibility(popup, siteUrl, evidenceDir, requests) {
  const key = popup.getByLabel('API Key', { exact: true });
  await expect(key).toHaveAttribute('type', 'password');
  await key.focus();
  await key.press('ArrowLeft');
  const caret = await key.evaluate((input) => input.selectionStart);
  await popup.getByRole('button', { name: '显示密钥', exact: true }).click();
  await expect(key).toHaveAttribute('type', 'text');
  await expect(key).toHaveValue('synthetic-key-only');
  assert.equal(await key.evaluate((input) => document.activeElement === input), true);
  assert.equal(await key.evaluate((input) => input.selectionStart), caret);
  const toggle = popup.getByRole('button', { name: '隐藏密钥', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await popup.screenshot({ path: join(evidenceDir, 'model-key-revealed.png'), animations: 'disabled' });
  await toggle.focus();
  await toggle.press('Enter');
  await expect(key).toHaveAttribute('type', 'password');
  await popup.getByRole('button', { name: '显示密钥', exact: true }).press('Space');
  await expect(key).toHaveAttribute('type', 'text');
  assert.equal(requests.length, 0, 'Visibility changes must not send a model request');
  const stored = await popup.evaluate(() =>
    chrome.storage.local.get(['workflowCredentials', 'workflowSettings'])
  );
  assert.equal(
    stored.workflowCredentials,
    undefined,
    'Enter on the visibility button must not save credentials'
  );
  assert.equal(stored.workflowSettings, undefined);
  await popup.getByRole('button', { name: '返回', exact: true }).click();
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveValue('synthetic-key-only');
  await popup.getByRole('button', { name: '显示密钥', exact: true }).click();
  await popup.getByLabel('接口地址', { exact: true }).fill(siteUrl + '/changed');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveValue('');
  await popup.getByLabel('接口地址', { exact: true }).fill(siteUrl + '/v1');
  await key.fill('synthetic-key-only');
  await popup.screenshot({ path: join(evidenceDir, 'model-key-hidden.png'), animations: 'disabled' });
}

/**
 * Exercises only the owned synthetic provider; returns a newly opened Popup after cancellation coverage.
 */
export async function verifyModelSettingsFeedback(popup, context, siteUrl, evidenceDir, control) {
  const popupUrl = popup.url();
  const endpoint = popup.getByLabel('接口地址', { exact: true });
  const model = popup.getByLabel('模型', { exact: true });
  const saved = popup.getByRole('group', { name: 'API Key 已保存' });
  await expect(saved).toBeVisible();
  await expect(popup.getByRole('button', { name: '显示密钥', exact: true })).toHaveCount(0);
  await expect(popup.locator('input#model-key')).toHaveCount(0);
  const original = await popup.evaluate(() => chrome.storage.local.get('skillRevision'));
  await popup.getByRole('button', { name: '拉取', exact: true }).click();
  await expect(popup.getByRole('status').filter({ hasText: '已获取 3 个模型' })).toBeVisible();
  assert.equal(control.discovery.calls.at(-1).authorization, 'Bearer synthetic-key-only');
  await popup.locator('[data-slot=scroll-area-viewport]').evaluate((node) => {
    node.scrollTop = 0;
  });
  const position = await endpoint.boundingBox();
  const first = control.requests.length;
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  const success = popup.getByRole('status').filter({ hasText: '连接成功' });
  await expect(success).toBeVisible();
  await expect(popup.getByRole('heading', { name: '模型设置', exact: true })).toBeVisible();
  await expect(saved).toBeVisible();
  assert.equal(control.requests.length, first + 1);
  assert.equal(control.requests.at(-1).authorization, 'Bearer synthetic-key-only');
  assert.equal(control.requests.at(-1).input.messages.at(-1).content, 'Reply with OK only.');
  assert.equal((await endpoint.boundingBox()).y, position.y);
  const toast = await success.boundingBox();
  const nav = await popup.getByLabel('模型设置导航').boundingBox();
  assert.ok(toast.y >= nav.y + nav.height && toast.y < position.y);
  await expect(success).toHaveAttribute('data-variant', 'success');
  await popup.screenshot({ path: join(evidenceDir, 'model-test-success-dark.png'), animations: 'disabled' });
  assert.deepEqual(
    (await popup.evaluate(() => chrome.storage.local.get('skillRevision'))).skillRevision,
    original.skillRevision
  );
  assert.equal(
    context.pages().some((page) => page.url().includes('/skill-host.html')),
    false
  );
  await popup.getByRole('button', { name: '关闭提示' }).click();

  control.setMode('error');
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  const failure = popup.getByRole('alert').filter({ hasText: '鉴权失败' });
  await expect(failure).toBeVisible();
  await expect(model).toHaveValue('qwen3.5-flash');
  assert.match(await failure.getAttribute('class'), /text-destructive/);
  await popup.screenshot({ path: join(evidenceDir, 'model-test-failure-dark.png'), animations: 'disabled' });
  await popup.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await popup.screenshot({ path: join(evidenceDir, 'model-test-failure-light.png'), animations: 'disabled' });
  await popup.getByRole('button', { name: '关闭提示' }).click();
  assert.equal(control.requests.length, first + 2, 'Failure must not retry');

  control.setMode('success');
  await popup.getByRole('button', { name: '更换', exact: true }).click();
  await expect(popup.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
  await popup.getByLabel('API Key', { exact: true }).fill('synthetic-key-replaced');
  await popup.getByRole('button', { name: '显示密钥', exact: true }).click();
  await expect(popup.getByLabel('API Key', { exact: true })).toHaveValue('synthetic-key-replaced');
  await popup.getByRole('button', { name: '隐藏密钥', exact: true }).click();
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(success).toBeVisible();
  assert.equal(control.requests.at(-1).authorization, 'Bearer synthetic-key-replaced');
  assert.equal(
    JSON.stringify(await popup.evaluate(() => chrome.storage.local.get('workflowCredentials'))).includes(
      'synthetic-key-replaced'
    ),
    false,
    'Testing does not save a replacement'
  );
  await popup.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(saved).toBeVisible();
  await expect(popup.getByRole('status').filter({ hasText: '配置已保存' })).toBeVisible();
  await popup.getByRole('button', { name: '关闭提示' }).click();
  await popup.screenshot({ path: join(evidenceDir, 'model-key-saved.png'), animations: 'disabled' });
  await popup.getByRole('button', { name: '更换', exact: true }).click();
  await popup.getByLabel('API Key', { exact: true }).fill('discarded-replacement');
  await popup.getByRole('button', { name: '取消更换', exact: true }).click();
  await expect(saved).toBeVisible();

  await endpoint.fill(siteUrl + '/other');
  await expect(saved).toHaveCount(0);
  await expect(popup.getByLabel('API Key', { exact: true })).toHaveValue('');
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(success).toBeVisible();
  assert.notEqual(control.requests.at(-1).authorization, 'Bearer synthetic-key-replaced');
  await endpoint.fill(siteUrl + '/v1');
  await expect(saved).toBeVisible();

  control.setMode('hold');
  const beforeEdit = control.requests.length;
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(popup.getByRole('button', { name: '测试中', exact: true })).toBeDisabled();
  await expect.poll(() => control.requests.length).toBe(beforeEdit + 1);
  await model.fill('fixture-model');
  await model.press('Escape');
  await expect.poll(() => control.requests.at(-1).closed).toBe(true);
  await expect(popup.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled();
  await expect(popup.locator('[data-slot=alert]')).toHaveCount(0);
  const beforeTab = control.requests.length;
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect.poll(() => control.requests.length).toBe(beforeTab + 1);
  await popup.getByRole('button', { name: '返回', exact: true }).click();
  await expect.poll(() => control.requests.at(-1).closed).toBe(true);
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(popup.getByRole('heading', { name: '模型设置', exact: true })).toBeVisible();
  await expect(model).toHaveValue('fixture-model');
  const beforeClose = control.requests.length;
  await popup.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect.poll(() => control.requests.length).toBe(beforeClose + 1);
  assert.equal(control.requests.at(-1).input.enable_thinking, undefined);
  await popup.close();
  await expect.poll(() => control.requests.at(-1).closed).toBe(true);
  popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(popupUrl);
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(popup.getByRole('group', { name: 'API Key 已保存' })).toBeVisible();
  assert.deepEqual(
    (await popup.evaluate(() => chrome.storage.local.get('skillRevision'))).skillRevision,
    original.skillRevision
  );
  await popup.getByRole('button', { name: '清除', exact: true }).click();
  await expect(popup.getByRole('status').filter({ hasText: '密钥已清除' })).toBeVisible();
  await expect(popup.getByLabel('API Key', { exact: true })).toHaveValue('');
  const persisted = await popup.evaluate(() => chrome.storage.local.get('workflowCredentials'));
  assert.equal(JSON.stringify(persisted).includes('synthetic-key-replaced'), false);
  return popup;
}
