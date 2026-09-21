/**
 * @author Codex
 * @description Initializes tools only inside an explicitly requested, disposable authorization inspection process.
 */
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {
  createPermissionModeService,
  createUnattendedToolCatalog,
} from '../../permission-system/sdk/index.js';
import { inspectionSettings } from './inspection-configuration.js';
import { resolveInspectionProjectTrust } from './inspection-project-trust.js';
import type { AgentSession, InlineExtension } from '@earendil-works/pi-coding-agent';
import type { TaskToolCatalogEntry } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Run the provider lifecycle without a model turn, then read the live registry rather than startup evidence.
 * Only the disposable inspection composition may call this function; normal sessions retain lazy loading.
 */
export async function collectInspectionTools(
  cwd: string,
  sessionId: string,
  extensionFactories: InlineExtension[],
  agentDir = getAgentDir()
): Promise<TaskToolCatalogEntry[]> {
  const settingsManager = inspectionSettings(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories });
  const errors: string[] = [];
  let session: AgentSession | undefined;
  try {
    await resourceLoader.reload({
      resolveProjectTrust: ({ extensionsResult }) =>
        resolveInspectionProjectTrust(cwd, agentDir, settingsManager, extensionsResult),
    });
    if (settingsManager.drainErrors().length) {
      throw new Error('Cannot read trusted workspace settings for authorization inspection.');
    }
    if (resourceLoader.getExtensions().errors.length) {
      throw new Error('An extension failed to load.');
    }
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(cwd, { id: sessionId }),
    }));
    await session.bindExtensions({ mode: 'rpc', onError: (error) => errors.push(error.error) });
    if (errors.length) {
      throw new Error('An extension failed during session initialization.');
    }
    await session.extensionRunner.emitBeforeAgentStart('', undefined, session.systemPrompt, { cwd });
    if (errors.length) {
      throw new Error('An extension failed during tool initialization.');
    }
    const policy = createPermissionModeService({ agentDir, cwd }).reloadPolicy(
      cwd,
      settingsManager.isProjectTrusted()
    );
    if (policy.diagnostics.length) {
      throw new Error('Permission configuration is invalid.');
    }
    return createUnattendedToolCatalog(session.getAllTools(), policy.policy);
  } finally {
    if (session) {
      session.setActiveToolsByName([]);
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    }
  }
}

/**
 * Return one private IPC result and exit so providers cannot retain an inspection session or database handle.
 */
export async function runTaskToolInspection(cwd: string, factories: InlineExtension[]): Promise<void> {
  if (process.env.DR_OCTOPUS_PROCESS_ROLE !== 'task-tool-inspection' || !process.send) {
    throw new Error('Authorization inspection requires its dedicated child process.');
  }
  let result: { success: boolean; tools?: TaskToolCatalogEntry[]; reason?: string };
  try {
    const descriptor = JSON.parse(process.env.DR_OCTOPUS_PERMISSION_EXECUTION ?? 'null') as {
      inspect?: boolean;
      cwd?: string;
      sessionId?: string;
    } | null;
    if (!descriptor?.inspect || descriptor.cwd !== cwd || !descriptor.sessionId) {
      throw new Error('Invalid inspection context.');
    }
    result = { success: true, tools: await collectInspectionTools(cwd, descriptor.sessionId, factories) };
  } catch (error) {
    result = {
      success: false,
      reason: error instanceof Error ? error.message : 'Tool initialization failed.',
    };
  }
  await new Promise<void>((resolve, reject) => {
    process.send!({ type: 'authorization-inspection', ...result }, (error: Error | null) =>
      error ? reject(error) : resolve()
    );
  });
  process.exit(result.success ? 0 : 1);
}
