/**
 * @author Codex
 * @description 统一分发 Octopus CLI 命令，并编排 Workspace Bootstrap 与 Pi CLI 启动
 */
import { getAgentDir, main as runPiCli } from '@earendil-works/pi-coding-agent';
import { installBundledInfra, isBundledInfraInstalled } from '../infra/index.js';
import { prepareOfflineEnv, prepareSubprocessEncodingEnv, prepareWorkspaceEnv } from './prepare-env.js';
import { isInteractiveTuiLaunch } from './launch-mode.js';
import { createWorkspaceExtension } from '../extensions/workspace/index.js';
import { createWorkspaceService } from '../extensions/workspace/sdk/index.js';
import { createProductizationExtension } from '../decorators/productization.js';
import { parseOctopusArgs } from './parse-args.js';
import { runSchedulerCli } from './scheduler-cli.js';
import { createOnboardingExtension } from '../extensions/onboarding/index.js';
import { createPermissionModeService } from '../extensions/permission-system/sdk/index.js';
import { createPermissionSystemExtension } from '../extensions/permission-system/index.js';
import { applyContextModeMcpEnvironment } from '../utils/context-mode-mcp-config.js';
import { createMemoryExtension } from '../extensions/memory/index.js';
import { createSchedulerExtension } from '../extensions/scheduler/index.js';
import { createSubagentBridgeExtension } from '../extensions/subagent-bridge/index.js';
import { createBackgroundTaskExtension } from '../extensions/background-task/index.js';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';

/**
 * @description 优先分发 Scheduler 管理命令，其余参数进入 Workspace 与 Pi CLI 启动流程
 * @param args 不包含 Node 可执行文件与脚本路径的参数
 */
export async function runOctopusCli(args: string[]): Promise<void> {
  if (args[0] === 'knowledge') {
    const { runKnowledgeCli } = await import('./knowledge-cli.js');
    return runKnowledgeCli(args.slice(args[1] === 'service' ? 2 : 1));
  }
  if (args[0] === 'scheduler' && args[1] === 'service') {
    return runSchedulerCli(args.slice(2));
  }

  const { workspaceSelector, piArgs } = parseOctopusArgs(args);

  const interactiveTuiLaunch = isInteractiveTuiLaunch(piArgs);
  if (interactiveTuiLaunch) {
    const { renderStartupLogo } = await import('./terminal-ui.js');
    await renderStartupLogo(piArgs);
  }

  // Apply Workspace Environment
  const workspaceService = createWorkspaceService();
  const workspace = await workspaceService.resolve(workspaceSelector);
  prepareWorkspaceEnv(workspace);

  if (interactiveTuiLaunch) {
    const { prepareInteractiveStartup } = await import('./interactive-startup.js');
    await prepareInteractiveStartup(piArgs);
  } else if (!(await isBundledInfraInstalled())) {
    await installBundledInfra();
  }

  // Package extensions run in the Agent process and do not automatically inherit MCP server.env.
  await applyContextModeMcpEnvironment();

  // Apply online startup defaults while preserving explicit offline settings
  prepareOfflineEnv();
  prepareSubprocessEncodingEnv();

  // 执行任务和检查授权的子进程都不提供定时任务管理能力。
  const processRole = process.env.DR_OCTOPUS_PROCESS_ROLE;
  const isTaskProcess = processRole === 'scheduled-task' || processRole === 'task-tool-inspection';

  const permissionService = createPermissionModeService();

  // Run Pi CLI with Extensions
  const extensionFactories: InlineExtension[] = [
    {
      name: 'octopus-memory',
      hidden: true,
      factory: createMemoryExtension({ readOnly: isTaskProcess || processRole === 'subagent' }),
    },
    ...(isTaskProcess
      ? []
      : [
          {
            name: 'octopus-scheduler',
            hidden: true,
            factory: createSchedulerExtension({
              agentDir: getAgentDir(),
              workspaceId: workspace.id,
              cwd: workspace.cwd,
              configRevision: workspace.updatedAt,
            }),
          },
        ]),
    {
      name: 'octopus-permission-system',
      hidden: true,
      factory: createPermissionSystemExtension(permissionService),
    },
    {
      name: 'octopus-productization',
      hidden: true,
      factory: createProductizationExtension(),
    },
    {
      name: 'octopus-onboarding',
      hidden: true,
      factory: createOnboardingExtension(),
    },
    {
      name: 'octopus-workspace',
      hidden: true,
      factory: createWorkspaceExtension(workspaceService),
    },
    ...(isTaskProcess
      ? []
      : [
          {
            name: 'octopus-knowledge',
            hidden: true,
            factory: interactiveTuiLaunch
              ? (
                  await import('../extensions/knowledge/extension/tui-commands.js')
                ).createKnowledgeTuiExtension(getAgentDir())
              : (await import('../extensions/knowledge/index.js')).createKnowledgeExtension({
                  agentDir: getAgentDir(),
                  workspaceId: workspace.id,
                  cwd: workspace.cwd,
                }),
          },
        ]),
  ];
  if (processRole === 'task-tool-inspection') {
    const { runTaskToolInspection } = await import('../extensions/scheduler/sdk/tool-inspection.js');
    await runTaskToolInspection(workspace.cwd, extensionFactories);
    return;
  }
  if (!isTaskProcess && processRole !== 'subagent') {
    extensionFactories.push({
      name: 'octopus-background-task',
      hidden: true,
      factory: createBackgroundTaskExtension(),
    });
    extensionFactories.push({
      name: 'octopus-subagent-bridge',
      hidden: true,
      factory: createSubagentBridgeExtension({
        agentDir: getAgentDir(),
        workspaceId: workspace.id,
        permissionService,
      }),
    });
  }
  await runPiCli(piArgs, { extensionFactories });
}
