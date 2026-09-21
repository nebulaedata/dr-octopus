---
name: pi-agent-sdk
description: "Build, integrate, or debug applications using @earendil-works Pi packages at v0.84.3: pi-ai, pi-agent-core, pi-coding-agent, and pi-tui. Use for model/provider calls, low-level agents and AgentHarness, coding sessions, extensions, tools, resource loading, session replacement, terminal UI, or architecture decisions about which Pi layer should own a capability."
---

# Pi Agent SDK

Use the current `earendil-works/pi` source as the authority. The packages evolve quickly; inspect the installed declarations or upstream source before relying on recalled APIs.

## Source authority

1. Inspect the consuming project's lockfile and installed package versions.
2. Prefer local `node_modules/@earendil-works/*/dist/*.d.ts` when dependencies are installed.
3. Otherwise inspect the matching tag or commit in `https://github.com/earendil-works/pi`.
4. Use the repository `main` branch only when the project intentionally targets latest.
5. Keep all Pi packages on mutually compatible versions; prefer the same release line.

Do not mix `@mariozechner/*` and `@earendil-works/*` imports in one integration.

When this skill's summaries are insufficient for full architectural understanding, read the upstream source directly — but scope reads narrowly to save time and tokens:

- Prefer already-installed `node_modules/@earendil-works/*/dist/*.d.ts` first; only fall back to the GitHub source when declarations or this skill don't answer the question.
- Target the specific package under `https://github.com/earendil-works/pi/tree/main/packages/<package-name>/src` (e.g. `packages/coding-agent/src`, `packages/agent-core/src`) instead of browsing the whole monorepo.
- Search for the specific symbol/export first (e.g. via GitHub code search or `grep` on a local clone) rather than reading entire files or directories end-to-end.
- Do not fetch the full repository tree or unrelated packages "just in case."

## Current baseline and breaking changes

The repository currently pins `@earendil-works/pi-coding-agent@0.84.3` and matching `0.84.3` Pi packages. v0.84.3 retains the v0.84.0 public API baseline except for the announced Google thinking-level type rename.

### v0.84.3 additions, changes, and fixes

- `GoogleThinkingLevel` was renamed to `GoogleApiThinkingLevel`; use `ResolvedGoogleThinkingLevel` for normalized adapter levels.
- Windows hosts may opt into the new `powershell` tool through `defaultTools` or SDK tool selection; it is not part of the default coding tool set.
- `/model` and `/thinking` selections are session-scoped unless explicitly persisted with Ctrl+S.
- JSON and RPC `toolcall_start` events now include tool call id and name; `message_update` retains delta-only content and restores cumulative usage reporting.
- Package resource globs use Node.js built-in deterministic visible-path matching. Re-test packages that depend on dot-path or symlink glob behavior.
- Nested Markdown skills under `.agents/skills/` grouping directories are discovered, while root Markdown files without valid skill frontmatter are ignored.

### v0.84.0 foundation

### Headline features
- Fullscreen TUI mode (`--tui-mode fullscreen`), runtime switching, sticky docks, draggable scrollbars.
- Mermaid and LaTeX rendering in interactive transcripts.
- Per-directory `AGENTS.override.md` context overrides.
- Arbitrary OpenAI-compatible `samplingParams` and opt-in vLLM `thinking_token_budget`.
- Built-in Baseten provider (`BASETEN_API_KEY`).

### Breaking changes
1. **pi-ai:** `ModelsStreamTransforms` renamed to `ModelsRequestTransforms`; header transforms now apply to all authenticated provider requests.
2. **JSON/RPC events:** `message_update` events emit only `assistantMessageEvent` deltas; cumulative `message` and `partial` fields removed. Assemble output between `message_start` and `message_end`.
3. **ModelRegistry:** `getApiKeyAndHeaders()` returns `ProviderHeaders` with `string | null` values (preserves `null` deletion markers). `refresh()` accepts `ModelsRefreshOptions` and returns `ModelsRefreshResult`.
4. **ModelRuntime:** `setRuntimeApiKey()` takes optional `AuthOperationOptions`; call `refresh({ providers, signal })` separately when you need fresh state.
5. **Extension OAuth:** `refreshToken(credentials, signal)` callbacks must honor the concrete abort signal.
6. **Dynamic providers:** replace direct `context.store` reads/writes with read-only `context.stored` and generation-guarded `context.publish({ persist, update })`.
7. **pi-agent-core session model:** legacy session/harness APIs removed; v4 lane-based `Session`, `SessionStorage`, `SessionRepo`, `JsonlSessionRepo`, `InMemorySessionRepo`, and v2 `AgentHarness` are now the default exports. Experimental subpaths removed.
8. **FileSystem implementations:** must provide `renameFile()` for atomic JSONL publication.
9. **Remote sessions:** session list summaries replaced with durable `SessionMetadata`; runtime state only available in acquired `SessionSnapshot`.

For full details see the upstream [v0.84.3 release notes](https://github.com/earendil-works/pi/releases/tag/v0.84.3), the intermediate [v0.84.2 release notes](https://github.com/earendil-works/pi/releases/tag/v0.84.2), the foundational [v0.84.0 release notes](https://github.com/earendil-works/pi/releases/tag/v0.84.0), and the per-package reference files in this skill.

## Choose the correct layer

Read [references/package-boundaries.md](references/package-boundaries.md) before changing architecture or package ownership.

| Need | Start with |
| --- | --- |
| Direct model/provider calls, streaming, message/tool schemas, auth primitives | `@earendil-works/pi-ai` |
| A custom stateful `Agent`, custom loop, or reusable headless harness | `@earendil-works/pi-agent-core` |
| Coding-agent sessions, extensions, project resources, settings, model runtime, built-in coding tools | `@earendil-works/pi-coding-agent` |
| Terminal rendering and input components | `@earendil-works/pi-tui` |

Important boundary: current `pi-agent-core` is more than a bare loop. It exports `AgentHarness`, session repositories, compaction, skills, system-prompt helpers, and built-in harness tools. `pi-coding-agent` remains the product-oriented coding harness with its extension system, resource discovery, settings, `ModelRuntime`, and `AgentSession`.

### Package dependency graph

Per `packages/coding-agent/package.json` upstream, `@earendil-works/pi-coding-agent` depends directly on `pi-agent-core`, `pi-ai`, `pi-client`, `pi-protocol`, and `pi-tui` (all pinned to the same release line, e.g. `^0.84.3`):

```
pi-coding-agent
├─ pi-agent-core   (Agent, AgentHarness, session repositories, compaction, skills)
├─ pi-ai           (model/provider calls, message & tool schemas)
├─ pi-client       (RPC/client bindings for driving a coding-agent session remotely)
├─ pi-protocol     (shared wire types/schemas between client and coding-agent server)
└─ pi-tui          (terminal rendering used by the built-in interactive/TUI mode)
```

Implications:

- `pi-ai` sits at the bottom; `pi-agent-core` builds on it, and `pi-coding-agent` builds on both. Never depend "upward" (e.g. `pi-ai` importing from `pi-agent-core`).
- `pi-coding-agent` re-exports a `./client` entry point backed by `pi-client`/`pi-protocol` for hosts that want to talk to a coding-agent process/server instead of embedding it in-process.
- `pi-tui` is a dependency of `pi-coding-agent` only for its own interactive CLI/TUI mode; other hosts (web/Electron/React) should not pull `pi-tui` in through `pi-coding-agent` and should keep TUI code in terminal hosts only.
- Keep all five packages on matching versions when upgrading; upstream release tags bump them together.

## Workflow

### 1. Establish the target

Determine the exact versions/commit, runtime, persistence needs, whether Pi extensions and resource discovery are required, and whether the host needs one session or replaceable new/resume/fork/import flows.

### 2. Select the narrowest public API

- Use `createModels()` and provider factories for direct LLM work.
- Use `Agent` for a custom stateful agent loop.
- Evaluate `AgentHarness` before rebuilding generic session persistence, compaction, skills, or file tools around `Agent`.
- Use `createAgentSession()` for normal coding-agent embedding.
- Use `createAgentSessionRuntime()` only when the host must replace the active session while preserving host-level wiring.
- Use extensions for Pi lifecycle hooks, commands, tools, providers, UI integrations, and context interception.

Never import internal `src/**` paths. Confirm every symbol from the package's public `src/index.ts` or installed declarations.

### 3. Implement ownership explicitly

- Infrastructure may configure `pi-ai` and construct low-level `Agent`/`AgentHarness` objects.
- The business runtime owns the live session, subscriptions, lifecycle, and singleton policy.
- HTTP, WebSocket, Electron IPC, React, and other transports never own canonical agent state.
- Extension factories register behavior and must not create a second authoritative runtime.

An instance factory creates fresh objects. It does not imply a global singleton. Enforce single-session behavior in the composition root or business runtime that owns creation and disposal.

### 4. Verify lifecycle and events

- Subscribe once at the owner boundary and unsubscribe/dispose during shutdown.
- Stream typed events outward; do not expose a mutable Pi object through transport APIs.
- Treat abort as cancellation, then await the relevant idle/settled primitive before teardown when required.
- Serialize prompts or define queueing behavior intentionally.
- Preserve session identifiers and repositories consistently across resume/fork/import flows.

### 5. Validate

- Type-check against the project's actual dependency versions.
- Use the faux provider for deterministic tests.
- Test tool success/failure, abort, streaming deltas, and session restore.
- For extensions, test load diagnostics and lifecycle events as well as tools/commands.
- For TUI components, verify every rendered line respects the supplied width.

## Critical API rules

### `pi-ai`

- The root entry is side-effect free and exports `Type`; do not add `@sinclair/typebox` merely for Pi tool schemas.
- Register provider factories explicitly. `@earendil-works/pi-ai/providers/all` is the heavy explicit built-in-provider entrypoint.
- Prefer `createModels()`. Treat `/compat` as migration compatibility, not the default for new integrations.
- Validate model-produced tool arguments before execution.

Read [references/pi-ai.md](references/pi-ai.md) for patterns.

### `pi-agent-core`

- `Agent` owns mutable state, prompting, tool execution, events, steering/follow-up queues, and cancellation.
- Supply a `streamFn` for a provider-agnostic standalone `Agent`; do not rely on another package's global compatibility initialization.
- `AgentHarness` is a separate higher-level core abstraction for headless session infrastructure.
- Distinguish `AgentMessage` from provider-facing LLM `Message`; use `convertToLlm` for custom messages.

Read [references/pi-agent-core.md](references/pi-agent-core.md) for patterns.

### `pi-coding-agent`

- `createAgentSession()` creates its own `Agent`; it accepts neither an existing `Agent` nor an `agentFactory` option.
- `createAgentSessionRuntime()` accepts a factory returning a complete runtime result, not a factory returning `Agent`.
- That runtime reuses the factory for new/resume/fork/import, so recreate all session-scoped wiring.
- `tools` is an allowlist, `excludeTools` a denylist, and `noTools` changes defaults.
- Load extensions through public resource/inline APIs and inspect load errors.
- Treat third-party extensions and skills as trusted code/configuration.

Read [references/pi-coding-agent.md](references/pi-coding-agent.md) for patterns.

For RPC mode, subprocess hosting, strict JSONL framing, commands/responses/events,
extension UI bridging, lifecycle, and client examples, read
[references/pi-rpc.md](references/pi-rpc.md). Treat the installed `rpc-types.d.ts` as
the exact wire-contract authority for the target version.

### `pi-tui`

- Program against `TUI` where possible; choose `TuiMainScreen` or `TuiAltScreen` at composition.
- Main screen preserves terminal scrollback; alternate screen owns a fixed viewport.
- `render(width)` output must never exceed `width`; use width-aware utilities.
- Keep TUI code in terminal hosts. Web/Electron renderers consume business events instead.

Read [references/pi-tui.md](references/pi-tui.md) before implementing terminal UI,
custom components, loaders, input handling, overlays, fullscreen layouts, or TUI tests.

## Common mistakes

- Describing `pi-agent-core` as only a thin loop and duplicating `AgentHarness` capabilities.
- Putting a long-lived singleton inside a reusable factory package.
- Depending on both Pi namespaces or mismatched release lines.
- Importing `@sinclair/typebox` when `pi-ai` exports `Type`.
- Pulling `providers/all` into a size-sensitive bundle unintentionally.
- Treating extension registration as injection for a prebuilt custom `Agent`.
- Rebinding only listeners after session replacement while forgetting resources, services, or extension lifecycle.
- Importing private source paths absent from package exports.

## Local examples

Use `examples/pi-agent-demo` for focused smoke tests. It is pinned to the skill's
v0.84.3 baseline; align all Pi dependencies together when validating another target
release. Never use `latest` as evidence for compatibility with an older lockfile.

Use `examples/pi-agent-demo/src/rpc-client-demo.ts` for the supported typed
subprocess client. Implement a raw JSONL client only when the host is not Node.js or
must own process supervision, correlation, timeouts, and extension UI routing.
