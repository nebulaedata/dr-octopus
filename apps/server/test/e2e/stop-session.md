# Session cancellation integration

Run after building `@octopus/shared` and `@octopus/server`:

```powershell
pnpm --filter @octopus/server exec node --test test/e2e/stop-session-real.test.mjs
```

This opt-in integration requires the installed `pi-subagents@0.68.0` extension. The default path is `~/.dr-octopus/agent/npm/node_modules/pi-subagents/index.ts`; override it with `PI_SUBAGENTS_TEST_PATH`. It fails explicitly if the package is missing.

The test runs the real Pi RPC CLI in a temporary workspace with isolated Agent configuration. A local OpenAI-compatible endpoint directs the parent to launch two actual child sessions and enter `bg_wait`. Since pi-subagents 0.65, each async child runs as an in-process native session inside its own detached runner OS process (two children → two runners). The test mirrors the agent directory into both agent-dir environment variables: the Pi host reads `DR_OCTOPUS_CODING_AGENT_DIR`, while pi-subagents runners resolve configuration through the upstream `PI_CODING_AGENT_DIR` name; without the latter the runners would read the real `~/.dr-octopus/agent`. The mock answers the stop-notification wake turns (≥0.65 injects a `subagent-notify` custom message that re-enters the model) with plain text so the loop can settle. The production Server stop coordinator must close both child model connections, terminate both runner PIDs, settle the fleet and produce a message recognized as cancellation. No paid model or existing user session is used. The printed evidence directory retains JSONL events; cleanup terminates the test process tree on Windows.

Browser coverage runs through `pnpm --filter @octopus/web test:e2e`. It verifies explicit cancellation and the known setup error, including partial output, immediate presentation and history recovery.

Production stop orchestration holds the acquired runtime generation, coalesces concurrent stops, aborts the main loop immediately and uses the advertised `/subagents-stop <run-id>` command for detached roots. It waits for the session fleet projection to leave active states. Incomplete projections, unavailable controls, rejected requests and timeouts fail visibly. This adapter uses the current session fleet widget contract; additional background providers need their own controls and completion evidence. Production code never scans or kills arbitrary OS processes.
