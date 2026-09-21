/**
 * @author Codex
 * @description Preserves tool-call boundaries when projecting retained execution messages for the timeline.
 */

/**
 * Group adjacent prose while keeping each structured tool call separate and in source order.
 * IDs remain stable within the original message; pagination still counts original messages.
 */
export function projectExecutionMessage(id: string, role: string, content: unknown) {
  const items: { id: string; role: string; text: string }[] = [];
  const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  if (!Array.isArray(parts)) {
    return items;
  }
  for (const [index, value] of (parts as unknown[]).entries()) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const part = value as Record<string, unknown>;
    const toolCall = role === 'assistant' && part.type === 'toolCall' && typeof part.name === 'string';
    const text = toolCall
      ? `[${String(part.name)}]\n${JSON.stringify(part.arguments, null, 2) ?? '{}'}`
      : part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : part.type === 'image'
          ? '[图片内容保存在执行记录中]'
          : '';
    if (!text) {
      continue;
    }
    const previous = items.at(-1);
    if (!toolCall && previous?.role === role) {
      previous.text += `\n${text}`;
    } else {
      items.push({ id: `${id}:${index}`, role: toolCall ? 'toolCall' : role, text });
    }
  }
  return items;
}
