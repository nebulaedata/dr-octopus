/**
 * @author Codex
 * @description Checks real MCP negotiation rejects missing upstream contracts and separates pinned package identity from server identity.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computerFixture } from './fixtures/computer-backend.mjs';
test('pinned upstream discovery and owned close succeed', async () =>
  computerFixture(async ({ connection }) => {
    assert.equal(connection.isConnected(), true);
    assert.equal(connection.readStatus().upstreamVersion, '0.8.8');
    assert.deepEqual(await connection.close(), { executionStopConfirmed: true });
  }));
test('missing required tool fails negotiation', async () => {
  await assert.rejects(
    computerFixture(
      async () => {
        assert.fail('must not admit');
      },
      { omit: 'Screenshot' }
    ),
    /WINDOWS_MCP_CONNECTION_FAILED/
  );
});

test('failed process cleanup remains failed and never reports a successful stop', async () => {
  await assert.rejects(
    computerFixture(async ({ connection, state }) => {
      state.cleanupFails = true;
      await assert.rejects(connection.close(), /WINDOWS_MCP_CLEANUP_UNCONFIRMED/);
      assert.equal(connection.readStatus().state, 'failed');
      assert.equal(connection.isConnected(), false);
    }),
    /WINDOWS_MCP_CLEANUP_UNCONFIRMED/
  );
});
