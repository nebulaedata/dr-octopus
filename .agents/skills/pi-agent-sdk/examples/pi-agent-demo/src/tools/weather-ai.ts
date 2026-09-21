import { Type } from "@earendil-works/pi-ai";

export const weatherAiTool = {
  name: "weather",
  description: "Get the current weather for a city",
  parameters: Type.Object({
    city: Type.String({ description: "City name, e.g. Shanghai" }),
  }),
};

export async function executeWeather(city: string) {
  return {
    content: [{ type: "text" as const, text: `Weather in ${city}: sunny, 25°C` }],
    details: {},
  };
}
