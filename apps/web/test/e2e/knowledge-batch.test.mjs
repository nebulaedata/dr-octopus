/**
 * @author Codex
 * @description Exercises collection menus and document selection through the real knowledge page with isolated HTTP fixtures.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { installSessionFixture } from './session-fixture.mjs';

let server;
let browser;
let baseURL;
const artifacts = join(tmpdir(), 'octopus-knowledge-batch');
before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen();
  baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Uses paginated fixtures and a single conflict to verify that partial deletion retains the failed selection.
 */
async function fixture(page) {
  await installSessionFixture(page);
  const collection = {
    id: 'collection-1',
    name: '团队集合',
    description: '',
    source: 'local',
    revision: 1,
    createdAt: '2026-09-11T00:00:00Z',
  };
  let documents = Array.from({ length: 21 }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `知识文档 ${index + 1}`,
    collectionId: collection.id,
    revision: index + 1,
    status: 'ready',
    format: 'docx',
    createdAt: collection.createdAt,
  }));
  const writes = [];
  let failDelete = true;
  await page.route('**/api/**/knowledge/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET')
      writes.push({ method: request.method(), path, body: request.postDataJSON() });
    if (path.endsWith('/collections')) return route.fulfill({ json: { items: [collection], total: 1 } });
    if (path.endsWith('/documents') && request.method() === 'GET') {
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      return route.fulfill({
        json: { items: documents.slice((pageNumber - 1) * 20, pageNumber * 20), total: documents.length },
      });
    }
    if (request.method() === 'DELETE' && path.includes('/documents/')) {
      const id = path.split('/').at(-1);
      if (id === 'doc-2' && failDelete) {
        failDelete = false;
        return route.fulfill({ status: 409, json: { message: '文档已变更，请刷新后重试' } });
      }
      documents = documents.filter((document) => document.id !== id);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/reindex')) return route.fulfill({ json: { id: 'job-1' } });
    if (path.includes('/jobs/'))
      return route.fulfill({
        json: {
          job: { id: 'job-1', kind: 'reindex', collectionId: collection.id, state: 'succeeded', attempt: 1 },
          leaves: [],
        },
      });
    if (request.method() === 'PATCH') {
      Object.assign(collection, request.postDataJSON().patch);
      return route.fulfill({ json: collection });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return writes;
}

test(
  'selection scopes indexing and deletion, resets across pages, and collection actions stay in the item menu',
  { timeout: 120000 },
  async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await fixture(page);
    try {
      await page.goto(new URL('/workspaces/workspace-e2e/knowledge', baseURL).href, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await expect(page.getByRole('checkbox', { name: '选择文档 知识文档 1', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
      const first = page.getByRole('checkbox', { name: '选择文档 知识文档 1', exact: true });
      await first.focus();
      await page.keyboard.press('Space');
      await expect(first).toBeChecked();
      await expect(page.getByRole('checkbox', { name: '全选当前页文档' })).toHaveAttribute(
        'aria-checked',
        'mixed'
      );
      await page.getByRole('button', { name: '批量索引', exact: true }).click();
      await expect.poll(() => writes.filter((write) => write.path.endsWith('/reindex')).length).toBe(1);
      assert.deepEqual(writes.at(-1).body.documentIds, ['doc-1']);
      await page.screenshot({ path: join(artifacts, 'desktop.png') });
      await page.getByRole('checkbox', { name: '全选当前页文档' }).click();
      await expect(page.getByText('已选 20 份')).toBeVisible();
      await page
        .getByRole('navigation', { name: '知识文档分页' })
        .getByRole('button', { name: '下一页' })
        .click();
      await expect(
        page.getByRole('checkbox', { name: '选择文档 知识文档 21', exact: true })
      ).not.toBeChecked();
      await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
      await page
        .getByRole('navigation', { name: '知识文档分页' })
        .getByRole('button', { name: '上一页' })
        .click();
      await first.check();
      await page.getByRole('checkbox', { name: '选择文档 知识文档 2', exact: true }).check();
      await page.getByRole('button', { name: '批量删除', exact: true }).click();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(writes.filter((write) => write.method === 'DELETE').length, 0);
      await page.getByRole('button', { name: '批量删除', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '删除文档', exact: true }).click();
      await expect(first).toHaveCount(0);
      await expect(page.getByText('已选 1 份')).toBeVisible();
      assert.deepEqual(
        writes.filter((write) => write.method === 'DELETE').map((write) => write.body.revision),
        [1, 2]
      );
      await page.getByRole('button', { name: '团队集合 集合操作', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: '编辑名称' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: '删除集合' })).toBeVisible();
      await page.screenshot({ path: join(artifacts, 'collection-menu.png') });
      await page.getByRole('menuitem', { name: '重新索引', exact: true }).click();
      await expect.poll(() => writes.filter((write) => write.path.endsWith('/reindex')).length).toBe(2);
      assert.equal(writes.at(-1).body.documentIds, undefined);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeVisible();
        assert.equal(
          await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth),
          true
        );
        await page.screenshot({ path: join(artifacts, `mobile-${width}.png`) });
      }
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.screenshot({ path: join(artifacts, 'mobile-dark.png') });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
);
