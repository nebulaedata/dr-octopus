/**
 * @author Codex
 * @description Binds child retrieval snapshots to Pi sessions and blocks delegation when mandatory registration fails.
 */
import { parseKnowledgeModeState } from '@octopus/shared/protocol/knowledge';
import { captureDelegatedPermissions, createPermissionModeService } from '../permission-system/sdk/index.js';
import { admissionDigest, startChildAdmission } from './admission.js';
import { inspectDelegatedTools } from './diagnostics.js';
import { CHILD_TOOLS } from './contracts.js';
import { ensureChildEntry, ensureExplorerAgent, loadRequiredChildApi } from './resources.js';
import type { PermissionModeService } from '../permission-system/sdk/index.js';
import type { ChildScope, RequiredChildApi } from './contracts.js';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Keep registry ownership inside the parent process; inject I/O boundaries for deterministic lifecycle tests.
 */
export function createSubagentBridgeExtension(
  options: { agentDir: string; workspaceId: string; permissionService?: PermissionModeService },
  dependencies = { loadRequiredChildApi, ensureChildEntry, ensureExplorerAgent }
) {
  return (pi: ExtensionAPI): void => {
    let registrations: ReturnType<RequiredChildApi['registerRequiredChildExtensions']>[] = [];
    let currentKey = '';
    let api: RequiredChildApi | undefined;
    let pending = Promise.resolve();
    let closed = false;
    let permissionService = options.permissionService;
    let latestContext: ExtensionContext | undefined;
    let admission: Awaited<ReturnType<typeof startChildAdmission>> | undefined;

    /**
     * Release old identities on reload/switch, including when the replacement uses a fresh factory closure.
     */
    function dispose(): void {
      for (const registration of registrations) {
        registration.dispose();
      }
      registrations = [];
      currentKey = '';
    }

    /**
     * Snapshot active parent tools and branch-owned collection scope; malformed persisted scope fails closed.
     */
    function capture(ctx: ExtensionContext) {
      if (closed) {
        throw new Error('Child bridge is closed');
      }
      const entry = [...ctx.sessionManager.getBranch()]
        .reverse()
        .find((item) => item.type === 'custom' && item.customType === 'octopus-knowledge-mode');
      const state = entry?.type === 'custom' ? parseKnowledgeModeState(entry.data) : undefined;
      if (entry && !state) {
        throw new Error('Invalid parent knowledge scope');
      }
      permissionService ??= createPermissionModeService({ agentDir: options.agentDir, cwd: ctx.cwd });
      const permissions = captureDelegatedPermissions(permissionService, ctx.cwd, ctx.isProjectTrusted());
      const diagnostics = inspectDelegatedTools({
        activeTools: pi.getActiveTools(),
        registeredTools: pi.getAllTools().map((tool) => tool.name),
        knowledgeEnabled: state?.enabled !== false,
        permissions,
        cwd: ctx.cwd,
      });
      const scope: ChildScope = {
        agentDir: options.agentDir,
        workspaceId: options.workspaceId,
        permissions,
        collectionIds: state?.collectionIds ?? [],
        tools: diagnostics.filter((tool) => tool.eligible).map((tool) => tool.name),
      };
      // 0.68.0 executors pass the Pi UUID while state/recovery paths use the session file.
      const sessionIds = [
        ...new Set([ctx.sessionManager.getSessionFile(), ctx.sessionManager.getSessionId()]),
      ].filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (!sessionIds.length) {
        throw new Error('Parent session identity is unavailable');
      }
      return { scope, sessionIds, key: JSON.stringify([sessionIds, scope]) };
    }

    /**
     * Publish an immutable scope and require every loader path to verify it with the current parent.
     */
    async function refresh(ctx: ExtensionContext): Promise<void> {
      const { scope, sessionIds, key } = capture(ctx);
      if (key === currentKey) {
        return;
      }
      api ??= await dependencies.loadRequiredChildApi(options.agentDir);
      await dependencies.ensureExplorerAgent(options.agentDir);
      admission ??= await startChildAdmission(async (digest) => {
        if (closed || !latestContext) {
          return false;
        }
        const context = latestContext;
        await synchronize(context);
        return !closed && context === latestContext && admissionDigest(capture(context).key) === digest;
      });
      const path = await dependencies.ensureChildEntry(scope, admission.descriptor(key));
      if (closed) {
        throw new Error('Child bridge is closed');
      }
      dispose();
      for (const sessionId of sessionIds) {
        registrations.push(
          api.registerRequiredChildExtensions({
            sessionId,
            extensions: [{ id: 'octopus-readonly-child', path }],
          })
        );
      }
      currentKey = key;
    }

    /**
     * Serialize concurrent refreshes without retaining a rejected queue or permitting stale registrations.
     */
    function synchronize(ctx: ExtensionContext): Promise<void> {
      const next = pending
        .then(() => refresh(ctx))
        .catch((error: unknown) => {
          // Keep an already published admission entry so slash/API launches still fail closed and can recover.
          // Partial registration has no currentKey and must roll back all identities.
          if (!currentKey) {
            dispose();
          }
          throw error;
        });
      pending = next.catch(() => undefined);
      return next;
    }

    pi.registerCommand('subagent-tools', {
      description: 'Explain built-in child tool admission: /subagent-tools [tool-name]',
      /**
       * Inspect parent admission only; a particular agent allowlist and service availability remain separate.
       */
      handler(args, ctx) {
        permissionService ??= createPermissionModeService({ agentDir: options.agentDir, cwd: ctx.cwd });
        try {
          const permissions = captureDelegatedPermissions(permissionService, ctx.cwd, ctx.isProjectTrusted());
          const entry = [...ctx.sessionManager.getBranch()]
            .reverse()
            .find((item) => item.type === 'custom' && item.customType === 'octopus-knowledge-mode');
          const state = entry?.type === 'custom' ? parseKnowledgeModeState(entry.data) : undefined;
          if (entry && !state) {
            throw new Error('Invalid parent knowledge scope');
          }
          const rows = inspectDelegatedTools(
            {
              activeTools: pi.getActiveTools(),
              registeredTools: pi.getAllTools().map((tool) => tool.name),
              knowledgeEnabled: state?.enabled !== false,
              permissions,
              cwd: ctx.cwd,
            },
            args.trim() ? [args.trim()] : CHILD_TOOLS
          );
          pi.sendMessage({
            customType: 'octopus-subagent-tools',
            display: true,
            content: JSON.stringify(
              {
                mode: permissions.mode,
                tools: rows,
                notes: [
                  '按父会话当前配置检查；实际参数将在执行时复核。',
                  '未检查特定子代理白名单或服务运行状态；eligible 不保证服务可用。',
                  'ask 需要人工确认，子代理不自动批准；父会话临时批准不跨会话复制。',
                ],
              },
              null,
              2
            ),
          });
        } catch (error) {
          pi.sendMessage({
            customType: 'octopus-subagent-tools',
            display: true,
            content: error instanceof Error ? error.message : 'Child permission inspection failed',
          });
        }
        // Web correlates slash completion through the same public notify surface as permission-mode.
        if (ctx.hasUI) {
          ctx.ui.notify('子代理工具诊断完成', 'info');
        }
        return Promise.resolve();
      },
    });

    pi.on('session_start', async (_event, ctx) => {
      closed = false;
      latestContext = ctx;
      await synchronize(ctx);
    });
    pi.on('session_shutdown', async () => {
      closed = true;
      await pending;
      dispose();
      latestContext = undefined;
      await admission?.close();
      admission = undefined;
    });
    pi.on('tool_call', async (event, ctx) => {
      if (event.toolName !== 'subagent') {
        return;
      }
      try {
        await synchronize(ctx);
      } catch {
        return {
          block: true,
          reason: 'Octopus 子代理只读扩展注册失败；请检查 pi-subagents 安装与构建产物。',
        };
      }
      return;
    });
  };
}
