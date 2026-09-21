/**
 * @author Codex
 * @description Binds state observations, lifecycle cleanup and background process guidance to Pi.
 */
import { BACKGROUND_STATUS_KEY } from '@octopus/shared/protocol';
import { assertManagedCommand } from './guard.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { BackgroundTaskManager } from '../services/task-manager.js';

/**
 * Registers lifecycle handlers without launching resources until a tool needs them.
 */
export function registerBackgroundEvents(pi: ExtensionAPI, service: BackgroundTaskManager): void {
  pi.on('session_start', (_event, ctx) => {
    service.observe((snapshot) => {
      if (ctx.hasUI) {
        ctx.ui.setStatus(
          BACKGROUND_STATUS_KEY,
          ctx.mode === 'rpc'
            ? JSON.stringify(snapshot)
            : `background · ${String(snapshot.activeCount)} active${snapshot.accepting ? '' : ' · stopping'}`
        );
      }
    });
  });
  pi.on('session_shutdown', () => service.dispose());
  pi.on('input', () => (service.snapshot().accepting ? undefined : { action: 'handled' as const }));
  pi.on('before_agent_start', (event) => ({
    systemPrompt:
      event.systemPrompt +
      '\n\n' +
      [
        'Process ownership: all launched processes, including indirect descendants, must remain under Agent cleanup and must not escape user Stop, session shutdown, or host exit.',
        pi.getActiveTools().includes('background_task')
          ? 'Use background_task for commands that outlive a tool call. Run the actual workload in foreground / no-daemon mode; the tool manages background execution.'
          : 'background_task is unavailable. Run only commands that finish within the tool call and leave no running descendants; do not use alternative background launchers.',
        'Never bypass ownership via shell backgrounding, nohup/disown/setsid, tmux/screen, detached launch APIs, or external services, schedulers, process managers, or detached containers. This includes equivalent mechanisms hidden in scripts or nested shells. Wrapping such a launcher in background_task does not establish ownership; if cleanup ownership is uncertain, inspect before launching.',
      ].join('\n'),
  }));
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'bash' && event.toolName !== 'powershell') {
      return;
    }
    try {
      const command = event.input['command'];
      if (typeof command !== 'string') {
        return { block: true, reason: 'INVALID_COMMAND' };
      }
      assertManagedCommand(command, event.toolName === 'powershell');
    } catch (error) {
      return { block: true, reason: (error as Error).message };
    }
    return;
  });
}
