# pi-agent-core patterns

## Standalone Agent

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";

const provider = fauxProvider();
const models = createModels();
models.setProvider(provider.provider);

const agent = new Agent({
  initialState: {
    systemPrompt: "You are helpful.",
    model: provider.getModel(),
    thinkingLevel: "off",
    tools: [],
  },
  streamFn: (model, context, options) => models.streamSimple(model, context, options),
});

const unsubscribe = agent.subscribe((event) => {
  // Forward typed events or update the host projection.
});
await agent.prompt("Hello");
await agent.waitForIdle();
unsubscribe();
```

Verify the current stream method/options against the installed version.

## Responsibilities and choice

`Agent` manages mutable state/messages, prompt/continue, tool-loop execution, subscriptions, abort/idle, and steering/follow-up. For custom application messages, use declaration merging and provide `convertToLlm`.

Inspect `AgentHarness` before composing a homegrown wrapper. It integrates reusable core sessions, models, tools, compaction, resources, hooks, queues, and system prompts.

- Choose `Agent` for direct control over state and the loop.
- Choose `AgentHarness` for generic headless session infrastructure.
- Choose coding-agent for Pi extensions, settings/resource conventions, and coding-session semantics.

Factories may construct agents, but the application composition root owns lifetime. Enforce a single active agent in the orchestrator, not with process-global state in a reusable core package.

## v0.84.x changes

The session/harness layer was rewritten in v0.84.0:

- Legacy session and JSONL/in-memory repository APIs are removed.
- v4 lane-based APIs are now the default: `Session`, `SessionStorage`, `SessionRepo`, `JsonlSessionRepo`, `InMemorySessionRepo`.
- v2 `AgentHarness` is promoted from an experimental subpath to the package's default export; experimental subpaths are removed.
- Custom `FileSystem` implementations must provide `renameFile()` for atomic JSONL publication.

`Agent` itself is unchanged at the high level, but any code depending on the old repository or harness APIs must migrate to the v4 primitives. Verify imports against the installed `dist/index.d.ts`.

In v0.84.1, `Agent.reset()` rejects while a run is active. Cancel and await idle before resetting; do not rely on reset to interrupt a live run.
