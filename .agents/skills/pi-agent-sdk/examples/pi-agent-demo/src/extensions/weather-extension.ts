import { ExtensionAPI, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.registerTool(
    defineTool({
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
    }),
  );
}
