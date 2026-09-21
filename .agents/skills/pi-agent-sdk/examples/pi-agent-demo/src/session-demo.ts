import { createAgentSession, ModelRuntime, SessionManager, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Set DEEPSEEK_API_KEY environment variable to run this demo.");
  process.exit(1);
}

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

const modelRuntime = await ModelRuntime.create();
await modelRuntime.setRuntimeApiKey("deepseek", apiKey);
const available = await modelRuntime.getAvailable("deepseek");
if (available.length === 0) {
  console.error("No DeepSeek models available. Check your API key.");
  process.exit(1);
}

const model = available[0];
console.log("Using model:", model.id);

const { session } = await createAgentSession({
  modelRuntime,
  model,
  sessionManager: SessionManager.inMemory(),
  tools: ["read", "weather"],
  customTools: [weatherTool],
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What's the weather in Shanghai?");
console.log("\n--- Final messages ---");
console.log(JSON.stringify(session.agent.state.messages.slice(-3), null, 2));

await session.dispose();
