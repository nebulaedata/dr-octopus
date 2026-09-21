import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { createModels, Type } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import path from "node:path";
import { fileURLToPath } from "node:url";

const weatherTool = defineTool({
  name: "weather",
  label: "Weather",
  description: "Get the current weather for a city",
  parameters: Type.Object({
    city: Type.String({ description: "City name, e.g. Shanghai" }),
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => ({
    content: [{ type: "text" as const, text: `Weather in ${params.city}: sunny, 25°C` }],
    details: {},
  }),
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, "extensions", "weather-extension.ts");

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);

const modelRuntime = await ModelRuntime.create();
modelRuntime.registerNativeProvider(faux.provider);

const available = await modelRuntime.getAvailable("faux");
if (available.length === 0) {
  console.error("Faux provider not available");
  process.exit(1);
}

const model = available[0];
console.log("Using model:", model.id);

// Pre-program the faux LLM: first call requests the weather tool, second answers
faux.setResponses([
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tool:1",
        name: "weather",
        arguments: { city: "Shanghai" },
      },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: Date.now(),
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "It's sunny and 25°C in Shanghai." }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 28, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  },
]);

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  additionalExtensionPaths: [extensionPath],
});
await loader.reload();

const { session, extensionsResult } = await createAgentSession({
  modelRuntime,
  model,
  sessionManager: SessionManager.inMemory(),
  resourceLoader: loader,
  tools: ["read", "weather"],
  customTools: [weatherTool],
});

console.log("Loaded extensions:", extensionsResult.extensions.length);
console.log("Tools:", session.agent.state.tools.map((t) => t.name));

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What's the weather in Shanghai?");
console.log("\n--- Final messages ---");
console.log(JSON.stringify(session.agent.state.messages.slice(-2), null, 2));

await session.dispose();
