# Package boundaries

## Dependency direction

```text
pi-ai
  ↑
pi-agent-core
  ↑
pi-coding-agent ──→ pi-tui (interactive terminal surface)
```

Applications should depend on the narrowest public package that exposes the needed behavior.

## Responsibilities

`pi-ai` owns the unified LLM contract: models, providers, authentication primitives, streaming/completion, messages, tool schemas, validation, usage, and provider adapters. It does not own an autonomous tool loop, durable agent session, coding workflow, extension lifecycle, or UI.

`pi-agent-core` owns `Agent` and its loop. Current source also exposes `AgentHarness`, session repositories/context reconstruction, compaction and branch summaries, skills/system prompts, core file tools, events, hooks, and queues. It suits custom headless agent products that do not want coding-agent product semantics.

`pi-coding-agent` owns the opinionated coding product/runtime: `AgentSession`, model/settings/auth resolution, extension APIs, resource discovery, coding tools, active-tool policy, prompts/themes, modes, and replaceable new/resume/fork/import sessions.

`pi-tui` owns terminal components, focus/input, overlays, images, keybindings, layout, and renderers. It is not a cross-platform domain UI.

## Recommended application split

```text
agent-core package
  - Pi version adapters
  - provider/model construction
  - custom Agent or AgentHarness construction
  - custom low-level messages and tools

agent-orchestrator package
  - owns active AgentSession/runtime
  - enforces singleton or multi-session policy
  - business workflows and permissions
  - event normalization and transport DTOs
  - start/stop/resume/fork lifecycle

apps
  - HTTP/WebSocket/Electron/TUI adapters
  - presentation state only
```

If the product primarily embeds `pi-coding-agent`, the orchestrator may depend on it directly while the lower package contains only genuinely reusable `pi-ai`/`pi-agent-core` adapters. Do not force every Pi type through an artificial wrapper.
