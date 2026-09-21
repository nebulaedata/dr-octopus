import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Set DEEPSEEK_API_KEY environment variable to run this demo.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, "extensions", "weather-extension.ts");

const modelRuntime = await ModelRuntime.create();
await modelRuntime.setRuntimeApiKey("deepseek", apiKey);
const available = await modelRuntime.getAvailable("deepseek");
if (available.length === 0) {
  console.error("No DeepSeek models available. Check your API key.");
  process.exit(1);
}

const model = available[0];
console.log("Using model:", model.id);

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
});

console.log("Loaded extensions:", extensionsResult.extensions.length);
console.log("Extension errors:", extensionsResult.errors.length > 0 ? extensionsResult.errors : "none");
console.log("Tools:", session.agent.state.tools.map((t) => t.name));

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What's the weather in Shanghai?");
console.log("\n--- Done ---");

await session.dispose();
