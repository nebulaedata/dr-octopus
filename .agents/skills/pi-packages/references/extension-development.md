# Pi Extension Development Reference

## Contents

- Extension forms and loading
- Factory contract and module boundaries
- Capability selection
- Event and lifecycle model
- Context and mode safety
- State and persistence
- Tools and output design
- Commands, shortcuts, flags, and UI
- Session replacement
- Concurrency, cancellation, and cleanup
- Error handling and security
- Testing strategy

## Extension forms and loading

Choose the smallest form that works:

```text
single file                 directory                    distributable package
my-extension.ts             my-extension/                my-package/
                            ├── index.ts                  ├── package.json
                            ├── tools.ts                  ├── extensions/
                            └── state.ts                  ├── skills/
                                                          ├── prompts/
                                                          └── themes/
```

Pi auto-discovers global extensions under `~/.pi/agent/extensions/` and project extensions under `.pi/extensions/`. Project-local extensions load only after the project is trusted. Use `pi -e ./path.ts` for an ephemeral test; place an extension in an auto-discovered location when `/reload` behavior is needed.

Pi supports TypeScript and JavaScript extension modules. A package may point its manifest directly to source `.ts` or to built `.js`; whichever path is chosen must exist in the installed or packed artifact.

## Factory contract and module boundaries

Export a default factory receiving `ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function exampleExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("Extension ready", "info");
  });
}
```

The factory may be async. Pi awaits it before `session_start`, `resources_discover`, and queued provider registration are completed. Use async factories only for bounded startup work that must finish before Pi proceeds, such as remote configuration or model discovery.

Do not start processes, sockets, watchers, intervals, or other long-lived work in the factory. Pi may invoke a factory in flows that never start a session, including discovery-oriented commands. Register handlers in the factory; initialize session resources later.

Import only public package exports. Typical public imports are:

- `@earendil-works/pi-coding-agent` for extension types and coding-agent helpers;
- `typebox` for tool input schemas;
- `@earendil-works/pi-ai` for AI utilities;
- `@earendil-works/pi-tui` for custom terminal components;
- Node.js built-ins and declared third-party dependencies.

For a small extension, closures and local helpers are appropriate. Extract a host-neutral service only when rules, state transitions, or integrations need independent tests or reuse. If dependency injection is useful, expose a named creator while retaining a normal default export:

```ts
export function createExtension(service: Service) {
  return function extension(pi: ExtensionAPI) {
    registerTools(pi, service);
  };
}

export default createExtension(createDefaultService());
```

This pattern is optional. Never require external host state just to load the default entry.

## Capability selection

Choose a surface by intent:

| Need | Pi surface |
| --- | --- |
| Let the model invoke a typed operation | `pi.registerTool()` |
| Let the user explicitly invoke an action | `pi.registerCommand()` |
| Observe, block, or transform runtime behavior | `pi.on()` |
| Add a keyboard action or CLI option | `pi.registerShortcut()`, `pi.registerFlag()` |
| Persist non-message session data | `pi.appendEntry()` |
| Customize tool/message/session display | renderer APIs or Markdown transformer |
| Add or override model providers | `pi.registerProvider()` |
| Discover extra skills, prompts, or themes | `resources_discover` |
| Build an interactive terminal flow | `ctx.ui`, guarded by `ctx.hasUI` |

Avoid registering a tool for behavior that should never be model-selected. Avoid hiding a user command inside an event handler. Use interception events only when changing the normal pipeline is intentional.

## Event and lifecycle model

The important ordering is:

```text
startup
  project_trust (eligible global/user and CLI extensions)
  session_start
  resources_discover

input
  extension command lookup
  input
  skill/template expansion
  before_agent_start
  agent_start
  turn_start
  context
  provider request hooks
  message and tool execution events
  turn_end
  agent_end
  agent_settled

session replacement
  session_before_switch or session_before_fork
  session_shutdown
  reload/rebind extension instances
  session_start
  resources_discover

exit
  session_shutdown
```

Use the narrowest event that owns the concern:

- `project_trust`: participate in trust decisions before project resources load. Check `ctx.hasUI`; return `undecided` when the extension does not own the decision.
- `resources_discover`: return additional skill, prompt, or theme paths for startup or reload.
- `input`: inspect raw input after extension-command matching and before skill/template expansion.
- `before_agent_start`: inject a message or alter system-prompt inputs for a turn.
- `context`: non-destructively transform the deep-copied message list before each model call.
- `tool_call`: validate or block a tool call before execution.
- `tool_result`: transform a completed result while preserving a valid result contract.
- `agent_settled`: act only after retry, compaction, and queued continuation work has fully settled.
- `session_shutdown`: release session resources and flush state idempotently.

Handlers from multiple extensions may chain in load order. Preserve prior transformations, return `undefined` when making no change, and avoid assuming exclusive ownership.

## Context and mode safety

`ExtensionContext` exposes runtime state such as `cwd`, session manager, model information, abort signal, UI, and idle controls. Treat context values as scoped capabilities, not global singletons.

- Use `ctx.cwd`, not `process.cwd()`, for the active Pi workspace.
- Check `ctx.isProjectTrusted()` before reading or executing project-controlled content when trust matters.
- Use `ctx.signal` for nested work during active turns. It may be `undefined` in idle commands or lifecycle events.
- Use `ctx.waitForIdle()` before operations that require a fully settled agent.
- Use `ctx.abort()` to request cancellation rather than inventing a parallel cancellation mechanism.
- Treat `ctx.getSystemPromptOptions()` and context files as sensitive data.

`ctx.ui` behaves by mode. Interactive TUI supports dialogs and custom components; print, JSON, and RPC modes may not. Always check `ctx.hasUI` before a flow that requires interaction. Provide a deterministic fallback: return an actionable error, accept explicit command arguments, use configuration, or skip cosmetic UI.

## State and persistence

Use the correct lifetime:

- closure variables: one loaded extension instance; discard on reload or session replacement;
- session custom entries via `pi.appendEntry()`: reconstructable session state that survives restart;
- files or external storage: cross-session or shared durable state;
- `ctx.ui.setState()`: UI state, not durable domain persistence.

For custom entries, use a stable namespaced `customType`, store JSON-serializable versioned data, and rebuild state during `session_start` from session entries. Do not store secrets in session history unless the product contract explicitly accepts that exposure.

## Tools and output design

Define tools with a stable name, user-facing label, precise description, TypeBox parameter schema, and an async executor. The description and schema are model instructions: state constraints and semantics there rather than relying on hidden validation.

Within `execute`:

- validate semantic constraints not expressible in the schema;
- propagate the supplied abort signal to subprocesses, fetches, and model calls;
- use `onUpdate` for meaningful streaming progress;
- return structured `content` and `details` consistently;
- mark failures according to the current public result contract;
- cap large output and preserve enough metadata to explain truncation;
- avoid returning secrets, raw credentials, or unbounded logs.

Assume tools may execute in parallel. Do not mutate shared state without serialization, immutable updates, or conflict handling. Tool lifecycle update events can interleave; completion order need not equal source order.

Register all dynamically discoverable tools up front. If using dynamic tool activation, keep a loader tool active and make activation changes additive during its execution so newly available definitions are recorded correctly.

Tool renderers should support partial progress and expanded detail, keep the default view compact, and fall back cleanly to textual `content`. Rendering must not be the only place important results exist.

## Commands, shortcuts, flags, and UI

Commands are explicit user actions. Parse arguments defensively, give clear descriptions, and use argument completion only for cheap, non-sensitive data. Command names can collide; Pi retains duplicates with numeric suffixes, so choose descriptive names without assuming uniqueness.

Shortcuts must not override important built-ins casually. Use configured keybinding helpers for displayed hints. Flags should have stable names, declared types, documented defaults, and no hidden global side effects during module import.

Keep UI cosmetic when possible. For dialogs and custom components:

- honor cancellation and terminal width;
- return control by invoking the completion callback exactly once;
- avoid blocking work in render methods;
- use injected theme and keybinding managers;
- keep Markdown transformers synchronous and inexpensive because they rerun during streaming, restoration, and width changes.

## Session replacement

`newSession`, `fork`, `navigateTree`, and `switchSession` can replace the active runtime. After a successful replacement, Pi shuts down the old extension instance, tears down the old runtime, binds a new instance, emits `session_start`, and only then runs `withSession`.

The `withSession` callback is lexically part of the old closure even though it receives a fresh replacement context. Therefore:

- capture only plain durable data such as strings, ids, and serialized configuration;
- do not use the old `pi`, command context, session manager, or extracted session-bound objects;
- use only the context passed to `withSession` for post-replacement work;
- assume old resources were already disposed by `session_shutdown`.

## Concurrency, cancellation, and cleanup

Create long-lived resources lazily at `session_start` or first use. Guard initialization so concurrent calls cannot create duplicate resources. Register `session_shutdown` immediately and make disposal safe to call more than once.

Track active work explicitly. On shutdown:

1. stop accepting new work;
2. abort cancellable operations;
3. await bounded cleanup where the API permits;
4. close processes, sockets, watchers, file handles, and timers;
5. clear references so a repeated shutdown is harmless.

Do not swallow aborts and report them as successful results. Distinguish cancellation, expected user errors, dependency/configuration errors, and unexpected defects.

## Error handling and security

Extensions execute with the user's full permissions. Minimize filesystem and network scope, validate paths and command arguments, avoid shell interpolation, and never treat untrusted project content as executable without the relevant trust boundary.

At user-facing boundaries, return concise actionable errors. Preserve detailed causes for diagnostics without leaking secrets. In event interception, fail open or closed based on the feature's security contract and document that choice. A permission gate should fail closed; cosmetic rendering should fall back to default output.

## Testing strategy

Test behavior at three levels as appropriate:

1. Unit-test validation, state transitions, and service logic without Pi.
2. Test factory registration with a narrow `ExtensionAPI` harness or the repository's supported extension test utilities.
3. Smoke-test the actual entry through Pi using `-e` or an isolated install.

Cover:

- registration names and schemas;
- success, validation failure, dependency failure, and abort paths;
- parallel execution when shared state exists;
- interactive and non-interactive modes;
- session start, reload/replacement, and repeated shutdown;
- state restoration from persisted entries;
- clean process exit with no leaked handles.
