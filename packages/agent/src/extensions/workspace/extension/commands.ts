/**
 * @author Codex
 * @description 注册 Workspace 查询与创建 Pi 命令
 */
import {
  findCurrentWorkspace,
  formatWorkspace,
  notifyWorkspaceResult,
  parseCreateCommand,
  parseWorkspaceSelector,
} from './utils.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { WorkspaceDescriptor } from '../definitions/types.js';
import type { WorkspaceService, WorkspaceSessionBootstrap } from '../definitions/port.js';

const USAGE = 'Usage: /workspace current | list | open <id-or-slug> | create <name> [--slug <slug>] [--open]';

/**
 * @description 注册 current、list 与 create 子命令；创建后不改变当前进程 cwd。
 *
 * @param pi 当前 Pi Extension API。
 * @param service Workspace 查询与创建使用的应用服务。
 */
export function registerWorkspaceCommand(
  pi: ExtensionAPI,
  service: WorkspaceService,
  sessionBootstrap: WorkspaceSessionBootstrap
): void {
  pi.registerCommand('workspace', {
    description: 'Usage: /workspace current | list | create | open',
    getArgumentCompletions: (argumentPrefix) => {
      const prefix = argumentPrefix.trim().toLowerCase();
      return [
        {
          value: 'current',
          label: 'current',
          description: 'Show the Workspace associated with the current cwd',
        },
        {
          value: 'list',
          label: 'list',
          description: 'List all managed Workspaces',
        },
        {
          value: 'open ',
          label: 'open <id-or-slug>',
          description: 'Create a new Session in a Workspace and switch to it',
        },
        {
          value: 'create ',
          label: 'create <name> [--slug <slug>] [--open]',
          description: 'Use --open to switch immediately after creating the Workspace',
        },
      ].filter((item) => item.value.startsWith(prefix));
    },
    handler: async (args, ctx) => {
      const action = args.trim() || 'current';
      if (action === 'current') {
        const workspace = await findCurrentWorkspace(service, ctx.cwd);
        notifyWorkspaceResult(
          ctx,
          workspace === undefined
            ? 'The current cwd is not a managed Octopus Workspace.'
            : formatWorkspace(workspace)
        );
        return;
      }
      if (action === 'list') {
        const workspaces = await service.list();
        notifyWorkspaceResult(ctx, workspaces.map(formatWorkspace).join('\n\n'));
        return;
      }
      if (action === 'open' || action.startsWith('open ')) {
        try {
          const workspace = await service.resolve(parseWorkspaceSelector(action.slice('open'.length)));
          await openWorkspace(workspace, service, sessionBootstrap, ctx);
        } catch (error) {
          notifyWorkspaceResult(ctx, error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (action === 'create' || action.startsWith('create ')) {
        try {
          const command = parseCreateCommand(action.slice('create'.length));
          const workspace = await service.create({
            name: command.name,
            ...(command.slug === undefined ? {} : { slug: command.slug }),
          });
          if (command.open) {
            await openWorkspace(workspace, service, sessionBootstrap, ctx);
          } else {
            notifyWorkspaceResult(
              ctx,
              `Workspace created:\n${formatWorkspace(workspace)}\n\nRun: octopus --workspace ${workspace.slug ?? workspace.id}`
            );
          }
        } catch (error) {
          notifyWorkspaceResult(ctx, error instanceof Error ? error.message : String(error));
        }
        return;
      }
      notifyWorkspaceResult(ctx, USAGE);
    },
  });
}

/**
 * @description 在当前 cwd 时创建普通新 Session；跨 cwd 时预创建合法空 Session 并交给 Pi replacement。
 */
async function openWorkspace(
  workspace: WorkspaceDescriptor,
  service: WorkspaceService,
  sessionBootstrap: WorkspaceSessionBootstrap,
  ctx: ExtensionCommandContext
): Promise<void> {
  const current = await findCurrentWorkspace(service, ctx.cwd);
  if (current?.id === workspace.id) {
    const result = await ctx.newSession();
    if (result.cancelled) {
      notifyWorkspaceResult(ctx, 'Workspace open was cancelled.');
    }
    return;
  }

  const pending = await sessionBootstrap.create(workspace.cwd, {
    cwd: ctx.cwd,
    sessionDir: ctx.sessionManager.getSessionDir(),
  });
  try {
    const result = await ctx.switchSession(pending.sessionPath);
    if (result.cancelled) {
      await pending.cleanup();
      notifyWorkspaceResult(ctx, 'Workspace open was cancelled.');
    }
  } catch (error) {
    await pending.cleanup();
    throw error;
  }
}
