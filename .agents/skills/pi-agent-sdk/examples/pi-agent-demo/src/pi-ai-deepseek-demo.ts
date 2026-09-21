import { type Context } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { weatherAiTool, executeWeather } from "./tools/weather-ai.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Set DEEPSEEK_API_KEY environment variable to run this demo.");
  process.exit(1);
}

const models = builtinModels();
const available = await models.getAvailable("deepseek");
if (available.length === 0) {
  console.error("No DeepSeek models available. Check your API key.");
  process.exit(1);
}

const model = available[0];
console.log("Using model:", model.id);

const context: Context = {
  systemPrompt: "You are a helpful assistant. Use the weather tool when asked about weather.",
  messages: [
    { role: "user", content: "What's the weather in Shanghai?", timestamp: Date.now() },
  ],
  tools: [weatherAiTool],
};

const assistantMessage = await models.complete(model, context, {
  tools: [weatherAiTool],
  apiKey,
});

console.log("Assistant message:", JSON.stringify(assistantMessage, null, 2));

const toolCall = assistantMessage.content.find((c) => c.type === "toolCall");
if (toolCall) {
  console.log("Tool call:", toolCall.name, toolCall.arguments);
  const result = await executeWeather((toolCall.arguments as { city: string }).city);
  console.log("Tool result:", result);
} else {
  const text = assistantMessage.content
    .filter((c) => c.type === "text")
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  console.log("Assistant text:", text);
}
