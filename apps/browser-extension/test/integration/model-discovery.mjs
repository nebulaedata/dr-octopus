/**
 * @author Codex
 * @description Exercises searchable model discovery and stale-request isolation through the real popup against an owned provider.
 */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { join } from 'node:path';

/**
 * Leaves valid settings ready for the existing compilation regression; no live account is used.
 */
export async function verifyModelDiscovery(popup, siteUrl, evidenceDir, control) {
  const model = popup.getByLabel('模型', { exact: true });
  const endpoint = popup.getByLabel('接口地址', { exact: true });
  const pull = popup.getByRole('button', { name: '拉取', exact: true });
  await endpoint.fill(siteUrl + '/v1');
  await popup.getByLabel('API Key', { exact: true }).fill('synthetic-key-only');
  await expect(model).not.toHaveAttribute('aria-invalid', 'true');
  assert.equal(control.calls.length, 0);
  await pull.click();
  await expect(popup.getByRole('status')).toContainText('已获取 3 个模型');
  assert.equal(control.calls[0].authorization, 'Bearer synthetic-key-only');
  await model.fill('qwen');
  const footerBefore = await popup
    .getByRole('button', { name: '保存并整理', includeHidden: true })
    .boundingBox();
  await model.press('ArrowDown');
  await expect(popup.getByRole('option', { name: 'qwen3.5-flash', exact: true })).toBeVisible();
  await expect(popup.getByRole('option', { name: 'other-model', exact: true })).toHaveCount(0);
  const footerAfter = await popup
    .getByRole('button', { name: '保存并整理', includeHidden: true })
    .boundingBox();
  assert.equal(footerAfter.y, footerBefore.y);
  await expect(popup.locator('[data-slot=combobox-content]')).toHaveCSS('opacity', '1');
  await popup.screenshot({ path: join(evidenceDir, 'model-list-search.png'), animations: 'disabled' });
  await popup.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await popup.screenshot({ path: join(evidenceDir, 'model-list-search-dark.png'), animations: 'disabled' });
  await popup.getByRole('option', { name: 'qwen3.5-flash', exact: true }).click();
  await expect(model).toHaveValue('qwen3.5-flash');
  await model.fill('qwen3.5-p');
  await expect(popup.getByRole('option', { name: 'qwen3.5-plus', exact: true })).toBeVisible();
  await model.press('ArrowDown');
  await model.press('Enter');
  await expect(model).toHaveValue('qwen3.5-plus');
  await model.fill('custom-manual');
  await expect(popup.locator('[data-slot=empty]')).toBeVisible();
  await model.press('Enter');
  await expect(popup.getByLabel('API Key', { exact: true })).toHaveValue('synthetic-key-only');
  await model.press('Escape');
  await expect(model).toHaveValue('custom-manual');
  control.mode = 'failure';
  await pull.click();
  await expect(popup.getByRole('alert')).toContainText('拉取失败');
  await expect(model).toHaveValue('custom-manual');
  await popup.screenshot({ path: join(evidenceDir, 'model-list-failure.png') });
  assert.equal(control.calls.length, 2);
  control.mode = 'empty';
  await pull.click();
  await expect(popup.getByRole('status')).toContainText('已获取 0 个模型');
  await expect(popup.getByRole('alert')).toHaveCount(0);
  control.mode = 'delayed';
  await pull.click();
  await expect(popup.getByRole('button', { name: '拉取中', exact: true })).toBeDisabled();
  await expect.poll(() => control.calls.length).toBe(4);
  await endpoint.fill(siteUrl + '/other');
  control.mode = 'success';
  await pull.click();
  await expect(popup.getByRole('status')).toContainText('已获取 3 个模型');
  control.release();
  await model.fill('qwen');
  await model.press('ArrowDown');
  await expect(popup.getByRole('option', { name: 'qwen3.5-plus', exact: true })).toBeVisible();
  await expect(popup.getByRole('option', { name: 'stale-model', exact: true })).toHaveCount(0);
  await popup.setViewportSize({ width: 360, height: 420 });
  await expect
    .poll(() => popup.locator('main').evaluate((node) => node.getBoundingClientRect().height))
    .toBe(420);
  await model.scrollIntoViewIfNeeded();
  await model.press('Escape');
  await model.press('ArrowDown');
  const menu = popup.locator('[data-slot=combobox-content]');
  await expect(menu).toHaveCSS('opacity', '1');
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      return Boolean(box && box.y >= 0 && box.y + box.height <= 420);
    })
    .toBe(true);
  // The intrinsic 600px body sizes native action popups; its hidden scroll offset is not the shell position.
  assert.equal(await popup.locator('main').evaluate((node) => node.getBoundingClientRect().top), 0);
  assert.equal(await popup.locator('main header').evaluate((node) => node.getBoundingClientRect().top), 16);
  const shortFooter = await popup
    .getByRole('button', { name: '保存并整理', includeHidden: true })
    .boundingBox();
  assert.ok(shortFooter.y + shortFooter.height <= 420);
  await popup.screenshot({ path: join(evidenceDir, 'model-list-short.png'), animations: 'disabled' });
  await model.press('Escape');
  await popup.setViewportSize({ width: 360, height: 600 });
  await endpoint.fill(siteUrl + '/v1');
  await model.fill('qwen3.5-flash');
  await model.press('Escape');
  assert.equal(control.calls.length, 5);
}
