# pi-ai patterns

## Explicit provider setup

```ts
import { createModels, type Context, Type } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

const models = createModels();
models.setProvider(openaiProvider());
const model = models.getModel("openai", "gpt-5");
if (!model) throw new Error("Configured model was not found");

const weather = {
  name: "weather",
  description: "Get weather for a city",
  parameters: Type.Object({ city: Type.String() }),
};

const context: Context = {
  systemPrompt: "Use tools when needed.",
  messages: [{ role: "user", content: "Weather in Shanghai?", timestamp: Date.now() }],
  tools: [weather],
};

const result = await models.complete(model, context, { tools: [weather] });
```

Verify factory names/model IDs against the installed release. Provider-specific entrypoints improve tree shaking. Use `builtinModels()` from `providers/all` only when loading every built-in provider is intentional.

## Streaming and tools

`models.stream()` returns typed events. Handle completion, error, abort, text/thinking deltas, and tool-call deltas according to the installed event union.

`pi-ai` describes tools but does not run an autonomous loop. The caller validates arguments, executes the tool, appends the assistant tool call and matching `toolResult`, then calls the model again. Use `Agent` when this loop should be managed automatically.

## Compatibility

The root entry is the modern side-effect-free API. `/compat` is a strict superset retained for migration and used inside parts of coding-agent. Prefer `createModels()` and explicit provider factories in new direct integrations.

## v0.84.x changes

- `ModelsStreamTransforms` is renamed to `ModelsRequestTransforms`. Header transforms now apply to all authenticated provider requests, not only streaming requests.
- `ModelRegistry.refresh()` accepts `ModelsRefreshOptions` and returns `ModelsRefreshResult`.
- `ModelRegistry.getApiKeyAndHeaders()` returns `ProviderHeaders` with `string | null` values; `null` is a deliberate deletion marker, not a missing value.
- New Baseten provider uses `BASETEN_API_KEY`.

Update existing imports and transform types when moving from 0.83.0.

v0.84.1 adds the Qwen Token Plan Individual built-in catalog on top of this API baseline and introduces no announced `pi-ai` breaking change.
