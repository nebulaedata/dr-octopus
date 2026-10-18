/**
 * @author Codex
 * @description Exercises shared image-viewer capabilities, gallery resets and Markdown integration in Chrome.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

let server;
let browser;
let baseURL;
const fixturePath = '/__image-preview-fixture.html';
const fixtureModule = '/__image-preview-fixture.tsx';
const fixtureSource = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImagePreviewDialog } from '/src/components/ImagePreviewDialog.tsx';
import { MarkdownRenderer } from '/src/components/MarkdownRenderer.tsx';
import '/src/index.css';
function Fixture() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const flags = Object.fromEntries([...new URLSearchParams(location.search)].map(([k,v]) => [k, v !== 'false']));
  return React.createElement(React.Fragment, null,
    React.createElement('button', { onClick: () => setOpen(true) }, 'Open viewer'),
    React.createElement(MarkdownRenderer, null, '![Markdown photo](/brand/logo-512.png)'),
    React.createElement(ImagePreviewDialog, { ...flags, open, onOpenChange: setOpen,
      src: '/brand/logo-512.png?image=' + index, title: 'Photo ' + (index + 1),
      gallery: { index, count: flags.single ? 1 : 2, onPrevious: () => setIndex(index - 1), onNext: () => setIndex(index + 1) } })
  );
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;

before(async () => {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [
      {
        name: 'image-preview-test-fixture',
        /**
         * Resolves the browser-only test entry without adding an application route.
         */
        resolveId(id) {
          if (id === fixtureModule) return '\0image-preview-fixture.tsx';
        },
        /**
         * Supplies the isolated component harness through Vite's normal React transform.
         */
        load(id) {
          if (id === '\0image-preview-fixture.tsx') return { code: fixtureSource, map: null };
        },
        /**
         * Serves a test-only HTML entry with normal Vite module handling.
         */
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url?.split('?')[0] !== fixturePath) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(
              await vite.transformIndexHtml(
                fixturePath,
                '<html><body><div id="root"></div><script type="module" src="' +
                  fixtureModule +
                  '"></script></body></html>'
              )
            );
          });
        },
      },
    ],
  });
  await server.listen();
  baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens the fixture using English labels, with a fresh browser state per test.
 */
async function openViewer(t, query = '') {
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  t.after(() => page.close());
  await page.goto(new URL(fixturePath + query, baseURL).href);
  await page.getByRole('button', { name: 'Open viewer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  return { page, dialog };
}

test('gallery retains image tools and resets transformations when changing images and reopening', async (t) => {
  const { page, dialog } = await openViewer(t);
  await expect(dialog.getByRole('button', { name: 'Previous image' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(dialog.getByText('125%')).toBeVisible();
  await dialog.getByRole('button', { name: 'Rotate right' }).click();
  await dialog.press('ArrowRight');
  await expect(dialog.getByText('2 / 2')).toBeVisible();
  await expect(dialog.getByText('100%')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reset image view' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Next image' })).toBeDisabled();
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open viewer', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Open viewer', exact: true }).click();
  await expect(dialog.getByText('100%')).toBeVisible();
});

test('disabled navigation blocks arrow keys while counter and tools remain independently available', async (t) => {
  const { dialog } = await openViewer(t, '?navigation=false&pannable=false');
  await expect(dialog.getByRole('button', { name: 'Next image' })).toHaveCount(0);
  await dialog.press('ArrowRight');
  await expect(dialog.getByText('1 / 2')).toBeVisible();
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(dialog.getByText('Drag to move')).toHaveCount(0);
});

test('single image hides navigation; narrow and dark views keep controls inside the dialog', async (t) => {
  const { page, dialog } = await openViewer(t, '?single=true');
  await expect(dialog.getByRole('button', { name: 'Next image' })).toHaveCount(0);
  await expect(dialog.getByText('1 / 1')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await dialog.boundingBox();
    for (const button of await dialog.getByRole('button').all()) {
      const rect = await button.boundingBox();
      assert.ok(rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width + 1);
    }
  }
});

test('all capabilities can be hidden while accessible naming and Escape dismissal remain', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(
    new URL(
      fixturePath +
        '?navigation=false&counter=false&zoomable=false&rotatable=false&pannable=false&showInfo=false&closeOnOverlayClick=false',
      baseURL
    ).href
  );
  await page.getByRole('button', { name: 'Open viewer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Photo 1' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview Markdown photo' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Markdown photo' })).toBeVisible();
});

test('zoom, rotation and counter flags control their own UI and wheel behavior', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(new URL(fixturePath + '?zoomable=false&rotatable=false&counter=false', baseURL).href);
  await page.getByRole('button', { name: 'Open viewer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const image = dialog.getByRole('img');
  await expect(image).toHaveCSS('opacity', '1');
  await expect(dialog.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Rotate right' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Reset image view' })).toHaveCount(0);
  await expect(dialog.getByText('1 / 2')).toHaveCount(0);
  await image.hover();
  await page.mouse.wheel(0, -200);
  await expect(image).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await dialog.getByRole('button', { name: 'Next image' }).click();
  await expect(dialog.getByRole('heading', { name: 'Photo 2' })).toBeVisible();
});

test('failed image load can be retried without closing the viewer', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  let failed = true;
  await page.route('**/brand/logo-512.png?image=*', (route) =>
    failed ? route.fulfill({ status: 503 }) : route.continue()
  );
  await page.goto(new URL(fixturePath, baseURL).href);
  await page.getByRole('button', { name: 'Open viewer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Unable to load image.');
  failed = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
