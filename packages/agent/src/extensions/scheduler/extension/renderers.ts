/**
 * @author Codex
 * @description Renders Scheduler completion messages as passive TUI status cards.
 */
import { Box, Text } from '@earendil-works/pi-tui';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Register the stable completion message type without changing its model-context semantics.
 */
export function registerSchedulerRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer('octopus-scheduler-completion', (message, { outputPad }, theme) => {
    const details = message.details as { status?: unknown } | undefined;
    const status = typeof details?.status === 'string' ? details.status : 'completed';
    const heading = theme.fg(
      status === 'succeeded' ? 'success' : status === 'needs_attention' ? 'warning' : 'accent',
      `Scheduler · ${status}`
    );
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    const box = new Box(outputPad, 1, (text) => theme.bg('customMessageBg', text));
    box.addChild(new Text(`${heading}\n${content}`, 0, 0));
    return box;
  });
}
