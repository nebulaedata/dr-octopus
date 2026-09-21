import { type Context } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { weatherAiTool, executeWeather } from "./tools/weather-ai.js";

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);

const model = faux.getModel();

const context: Context = {
  systemPrompt: "You are a helpful assistant. Use the weather tool when asked about weather.",
  messages: [
    { role: "user", content: "What's the weather in Shanghai?", timestamp: Date.now() },
  ],
  tools: [weatherAiTool],
};

// First response: the assistant requests the weather tool
faux.setResponses([
  fauxAssistantMessage(fauxToolCall("weather", { city: "Shanghai" })),
]);

const assistantMessage1 = await models.complete(model, context, { tools: [weatherAiTool] });
console.log("Assistant message 1:", JSON.stringify(assistantMessage1, null, 2));

const toolCall = assistantMessage1.content.find((c) => c.type === "toolCall");
if (!toolCall) {
  throw new Error("Expected assistant to call weather tool");
}

const toolResult = await executeWeather((toolCall.arguments as { city: string }).city);

context.messages.push(assistantMessage1);
context.messages.push({
  role: "toolResult" as const,
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: toolResult.content,
  details: toolResult.details,
  isError: false,
  timestamp: Date.now(),
});

// Second response: final answer based on tool result
faux.appendResponses([fauxAssistantMessage("It's sunny and 25°C in Shanghai.")]);

const assistantMessage2 = await models.complete(model, context, { tools: [weatherAiTool] });
console.log("Assistant message 2:", JSON.stringify(assistantMessage2, null, 2));
