/**
 * @author Codex
 * @description Captures one permission-checked active tab into a bounded JPEG without capturing a replacement tab.
 */
import { browser } from 'wxt/browser';
import { browserSnapshotImageSchema } from '@octopus/shared/protocol/browser-tools';
let lastCapture = -Infinity;
let capturing = false;
let captureWindow: number | undefined;
let captureTab: number | undefined;
let interrupted = false;
browser.tabs.onActivated.addListener((info) => {
  if (info.windowId === captureWindow) {
    interrupted = true;
  }
});
browser.tabs.onUpdated.addListener((id, change) => {
  if (id === captureTab && (change.url || change.status === 'loading')) {
    interrupted = true;
  }
});
/**
 * Verifies the active tab before and after capture and the matching DOM baseline after asynchronous image encoding.
 */
export async function captureBrowserImage(tabId: number, verify: () => Promise<void>) {
  if (capturing) {
    throw new Error('BROWSER_BUSY');
  }
  capturing = true;
  try {
    const delay = Math.max(0, 550 - (performance.now() - lastCapture));
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return await capture(tabId, verify);
  } finally {
    capturing = false;
    captureWindow = undefined;
    captureTab = undefined;
    interrupted = false;
  }
}
/**
 * Owns one screenshot and its bounded encoding after capture admission.
 */
async function capture(tabId: number, verify: () => Promise<void>) {
  const target = await browser.tabs.get(tabId);
  const windowId = target.windowId;
  if (windowId === undefined) {
    throw new Error('TARGET_CHANGED');
  }
  captureWindow = windowId;
  captureTab = tabId;
  /**
   * Refuses captures when focus, navigation or the browser-owned target identity changed.
   */
  async function active() {
    if (interrupted) {
      throw new Error('TARGET_CHANGED');
    }
    const [selected] = await browser.tabs.query({ active: true, windowId });
    if (selected?.id !== tabId || selected.url !== target.url) {
      throw new Error('TARGET_CHANGED');
    }
    await verify();
    if (interrupted) {
      throw new Error('TARGET_CHANGED');
    }
  }
  await active();
  lastCapture = performance.now();
  const source = await browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 });
  await active();
  const bitmap = await createImageBitmap(await (await fetch(source)).blob());
  try {
    let scale = Math.min(1, 1280 / bitmap.width, 1280 / bitmap.height);
    for (let attempt = 0; attempt < 4; attempt++) {
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('ACTION_FAILED');
      }
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
      if (blob.size <= 131072) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        await active();
        return browserSnapshotImageSchema.parse({
          mimeType: 'image/jpeg',
          data: btoa(binary),
          width,
          height,
        });
      }
      scale *= 0.7;
    }
    throw new Error('PAYLOAD_TOO_LARGE');
  } finally {
    bitmap.close();
  }
}
