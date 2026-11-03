/**
 * @author Codex
 * @description Checks full-width popup scroll boundaries and content-owned spacing against the approved Box layout.
 */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/**
 * Measures the rendered viewport and its padded content instead of relying on class-name snapshots.
 */
export async function verifyPopupContentBounds(popup, label) {
  const region = popup.getByLabel(label, { exact: true });
  const geometry = await region.evaluate((root) => {
    const viewport = root.querySelector('[data-slot="scroll-area-viewport"]');
    const content = viewport.firstElementChild;
    const rect = viewport.getBoundingClientRect();
    const main = getComputedStyle(document.querySelector('main'));
    const padding = getComputedStyle(content);
    return {
      x: rect.x,
      right: rect.right,
      width: innerWidth,
      leftPadding: padding.paddingLeft,
      rightPadding: padding.paddingRight,
      mainLeft: main.paddingLeft,
      mainRight: main.paddingRight,
    };
  });
  assert.equal(geometry.x, 0, `${label}: scroll viewport must reach the left edge`);
  assert.equal(geometry.right, geometry.width, `${label}: scroll viewport must reach the right edge`);
  assert.equal(geometry.mainLeft, '0px');
  assert.equal(geometry.mainRight, '0px');
  assert.equal(geometry.leftPadding, '16px');
  assert.equal(geometry.rightPadding, '16px');
  const scrollbar = region.locator('[data-slot="scroll-area-scrollbar"]');
  if (await scrollbar.count()) {
    const bounds = await scrollbar.boundingBox();
    if (bounds) {
      assert.equal(bounds.x + bounds.width, geometry.width, `${label}: scrollbar must sit at the popup edge`);
    }
  }
}

/**
 * Focuses a field and verifies room for its three-pixel ring inside every viewport edge.
 */
export async function verifyFieldFocusSpace(popup, label, field) {
  await field.focus();
  await expect(field).toBeFocused();
  const geometry = await field.evaluate((input, label) => {
    const viewport = document
      .querySelector(`[aria-label="${label}"] [data-slot="scroll-area-viewport"]`)
      .getBoundingClientRect();
    const control = (input.closest('[data-slot="input-group"]') ?? input).getBoundingClientRect();
    return {
      left: control.left - viewport.left,
      right: viewport.right - control.right,
      top: control.top - viewport.top,
      bottom: viewport.bottom - control.bottom,
      shadow: getComputedStyle(input).boxShadow,
    };
  }, label);
  for (const side of ['left', 'right', 'top', 'bottom']) {
    assert.ok(geometry[side] >= 3, `${label}: ${side} focus ring is clipped`);
  }
  assert.notEqual(geometry.shadow, 'none');
}
