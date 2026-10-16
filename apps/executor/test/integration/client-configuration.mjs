/**
 * @author Codex
 * @description Supplies explicit separate approval and optional download steps to integration fixtures without replacing production APIs.
 */
import assert from 'node:assert/strict';

/**
 * Downloads configuration for the last fixture-created grant using the real finite Preload action.
 */
export async function downloadCreatedConfiguration(page, transport = 'http') {
  const access = await page.evaluate(() => window.executor.readAccess());
  assert.equal(access.ok, true);
  const clientId = access.data.clients.at(-1).clientId;
  const reply = await page.evaluate((input) => window.executor.downloadClientConfiguration(input), {
    clientId,
    transport,
  });
  assert.deepEqual(reply, { ok: true, cancelled: false });
  return clientId;
}

/**
 * Creates a grant first, then independently downloads its selected transport configuration.
 */
export async function createClientConfiguration(page, input) {
  const approval = await page.evaluate((value) => window.executor.approveAccess(value), {
    label: input.label,
    permissions: input.permissions,
    waitBudgetMs: input.waitBudgetMs,
  });
  assert.equal(approval.ok, true);
  await downloadCreatedConfiguration(page, input.transport ?? 'http');
  return approval;
}
