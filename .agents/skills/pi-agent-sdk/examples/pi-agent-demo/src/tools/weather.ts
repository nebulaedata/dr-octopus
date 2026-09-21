import { Type } from "@earendil-works/pi-ai";

export const weatherTool = {
  name: "weather",
  label: "Weather",
  description: "Get the current weather for a city",
  parameters: Type.Object({
    city: Type.String({ description: "City name, e.g. Shanghai" }),
  }),
  execute: async (_toolCallId: string, params: { city: string }, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown) => ({
    content: [{ type: "text" as const, text: `Weather in ${params.city}: sunny, 25°C` }],
    details: {},
  }),
};
