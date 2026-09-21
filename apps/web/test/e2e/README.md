# Session browser regressions

Run from the repository root:

```powershell
pnpm --filter @octopus/web exec playwright install chromium
pnpm --filter @octopus/web test:e2e
```

The Node test runner builds production assets into `node_modules/.playwright-build`, starts an isolated preview server and a headless browser, then closes both. To use an installed Edge browser, set `$env:PLAYWRIGHT_CHANNEL = 'msedge'`. Optionally set `E2E_BASE_URL` to an existing Web server.

These are browser end-to-end tests with mocked HTTP and WebSocket boundaries: the production router, Composer, Stop button, realtime client, store and transcript renderer run unchanged. They do not validate a live Pi process or model provider and do not send requests to user sessions.

Coverage includes both explicit `aborted` and the known Pi setup cancellation (`error` with the exact message `This operation was aborted`): stopping before text arrives, preserving partial output, displaying interruption before `agent_settled`, and restoring cancellation after reload. Other error messages containing “aborted” remain failures. Screenshots are written to the ignored `apps/web/.playwright-artifacts/` directory.
