/**
 * @author Codex
 * @description Verifies screenshot identity checks, encoding bounds and admission release through actual capture orchestration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/browser-screenshot.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
});
/**
 * Supplies only browser capture and canvas peers; production identity and byte-limit checks remain under test.
 */
function fixture(t, replace = false) {
  let selected = 1;
  let activation;
  let captures = 0;
  let closed = 0;
  const oldBitmap = globalThis.createImageBitmap;
  const oldCanvas = globalThis.OffscreenCanvas;
  globalThis.createImageBitmap = async () => ({
    width: 2560,
    height: 1440,
    close() {
      closed++;
    },
  });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { drawImage() {} };
    }
    async convertToBlob() {
      return new Blob([Uint8Array.from([255, 216, 255, 217])], { type: 'image/jpeg' });
    }
  };
  t.after(() => {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.OffscreenCanvas = oldCanvas;
  });
  const browser = {
    tabs: {
      onActivated: {
        addListener: (listener) => {
          activation = listener;
        },
      },
      onUpdated: { addListener() {} },
      get: async () => ({ id: 1, windowId: 10, url: 'http://fixture.test/' }),
      query: async () => [{ id: selected, url: 'http://fixture.test/' }],
      captureVisibleTab: async (windowId, options) => {
        assert.equal(windowId, 10);
        assert.equal(options.format, 'jpeg');
        captures++;
        if (replace) {
          selected = 2;
        }
        if (replace === 'switch-back') {
          activation({ windowId: 10, tabId: 2 });
          selected = 1;
          activation({ windowId: 10, tabId: 1 });
        }
        return 'data:image/jpeg;base64,/9j/2Q==';
      },
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    (id) => (id === 'wxt/browser' ? { browser } : require(id)),
    module,
    module.exports
  );
  return { ...module.exports, counts: () => ({ captures, closed }) };
}

test('captures a bounded JPEG and verifies the matching page before publication', async (t) => {
  const f = fixture(t);
  let checks = 0;
  const image = await f.captureBrowserImage(1, async () => {
    checks++;
  });
  assert.deepEqual(image, { mimeType: 'image/jpeg', data: '/9j/2Q==', width: 1280, height: 720 });
  assert.equal(checks, 3);
  assert.deepEqual(f.counts(), { captures: 1, closed: 1 });
});

test('a tab replacement during capture cannot return pixels under the old identity', async (t) => {
  const f = fixture(t, true);
  await assert.rejects(
    f.captureBrowserImage(1, async () => {}),
    /TARGET_CHANGED/
  );
  assert.equal(f.counts().captures, 1);
});

test('a stale DOM baseline prevents capture and releases admission for a subsequent read', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.captureBrowserImage(1, async () => {
      throw new Error('STALE_SNAPSHOT');
    }),
    /STALE_SNAPSHOT/
  );
  assert.equal(f.counts().captures, 0);
  assert.equal((await f.captureBrowserImage(1, async () => {})).mimeType, 'image/jpeg');
});

test('switching away and back during capture is rejected even when the final tab ID matches', async (t) => {
  const f = fixture(t, 'switch-back');
  await assert.rejects(
    f.captureBrowserImage(1, async () => {}),
    /TARGET_CHANGED/
  );
});
