/**
 * @author Codex
 * @description Adapts terminal knowledge service commands without loading QA tools, model settings or session mode state.
 */
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

const USAGE = '用法：/knowledge service start|stop|restart|status';

/**
 * Register explicit service management; registration and health checks never start the daemon.
 *
 * @param agentDir Agent profile directory shared with other applications on this host.
 */
export function createKnowledgeTuiExtension(agentDir: string): ExtensionFactory {
  return (pi): void => {
    pi.registerCommand('knowledge', {
      description: `${USAGE}；TUI 仅管理服务，知识库问答请到其他应用端使用`,
      /**
       * Dispatch lifecycle operations lazily and show their actual status, including health checks.
       */
      async handler(args, ctx) {
        const [scope, action, extra] = args.trim().split(/\s+/u);
        if (
          scope !== 'service' ||
          extra ||
          !action ||
          !['start', 'stop', 'restart', 'status'].includes(action)
        ) {
          throw new Error(USAGE);
        }
        const lifecycle = await import('../sdk/lifecycle.js');
        const operations = {
          start: lifecycle.startKnowledgeService,
          stop: lifecycle.stopKnowledgeService,
          restart: lifecycle.restartKnowledgeService,
          status: lifecycle.checkKnowledgeServiceHealth,
        };
        const result = await operations[action as keyof typeof operations](agentDir);
        if (ctx.hasUI) {
          ctx.ui.notify(JSON.stringify(result, null, 2), 'info');
        }
      },
    });
  };
}
