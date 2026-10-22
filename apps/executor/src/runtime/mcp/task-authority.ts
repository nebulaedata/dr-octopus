/**
 * @author Codex
 * @description Owns current grants, one global task admission and durable task/operation summaries for MCP and Host.
 */
import {
  enabledToolsSchema,
  defaultToolPolicySettings,
  type PolicyToolName,
} from '../../contracts/tool-policy';
import { selectedPolicyTools } from './tool-policy';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import type { DeviceIdentity } from '../../contracts/device-identity';
import { BasicToolError, shellInputSchema } from '../basic/basic-inputs';
import type { BasicTools } from '../basic/basic-tools';
import { resolveLocalPath } from '../basic/file-policy';
import { clientSummarySchema } from '../../contracts/access';
import { basicPermissionSchema } from '../../contracts/access';
import type { ApprovalInput, ExecutorPermission } from '../../contracts/access';
import { browserSchemas, type BrowserName, type BrowserTools } from '../browser/browser-tools';
import { computerSchemas, type ComputerName } from '../computer/computer-inputs';
import type { ComputerTools } from '../computer/computer-tools';
import type { ControlStore } from './control-store';
import type { Grant, TaskRecord } from './control-store';
import { taskStartSchema, taskStatusSchema } from './control-inputs';
import type { TransferService } from '../transfer/transfer-service';
import type { TransferControlName } from '../transfer/transfer-inputs';
import { transferControlSchemas } from '../transfer/transfer-inputs';

export type BasicName = 'read' | 'write' | 'edit' | 'powershell' | 'grep' | 'find' | 'ls';
export type ToolName = BasicName | ComputerName | Exclude<BrowserName, 'browser_list' | 'browser_tabs'>;

/**
 * Produces stable non-content identifiers; raw commands and file contents never enter the control journal.
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class TaskAuthority {
  private enabledTools = new Set<string>(selectedPolicyTools(defaultToolPolicySettings));
  toolPolicyRevision = 0;

  /**
   * Replaces admission switches synchronously; already admitted operations keep their original lifecycle.
   */
  setToolPolicy(enabledTools: PolicyToolName[], revision: number): void {
    if (revision < this.toolPolicyRevision) {
      throw new BasicToolError('STALE_POLICY', 'The tool policy revision is stale.');
    }
    this.enabledTools = new Set(enabledToolsSchema.parse(enabledTools));
    this.toolPolicyRevision = revision;
  }

  /**
   * Projects the current global tool switch independently of client grants and backend health.
   */
  isToolEnabled(name: string): boolean {
    return this.enabledTools.has(name);
  }

  /**
   * Refuses cached tool calls before they can create task records or dispatch work.
   */
  requireToolEnabled(name: string): void {
    if (!this.isToolEnabled(name)) {
      throw new BasicToolError('TOOL_DISABLED', 'This tool is disabled by the Executor tool policy.');
    }
  }

  private transferService?: TransferService;

  /**
   * Exposes the single attached transfer owner without allowing transport code to replace it.
   */
  get transfers(): TransferService | undefined {
    return this.transferService;
  }

  /**
   * Restores publication barriers into the existing task authority without reopening recovered tasks.
   */
  async attachTransfers(service: TransferService): Promise<void> {
    if (this.transfers) {
      throw new Error('Transfer service already attached');
    }
    this.transferService = service;
    await service.recover();
    for (const record of service.store.records.values()) {
      if (record.status === 'unknown') {
        const task = this.task(record.ownerId, record.taskId);
        task.quarantined = true;
        this.active ??= task.taskId;
        await this.store.saveTask(task);
      }
    }
  }

  /**
   * Rechecks task ownership and file authority for control and byte requests without creating another task owner.
   */
  transferContext(clientId: string, taskId: string, upload: boolean, active: boolean, touch: boolean) {
    const grant = this.requireGrant(clientId);
    const task = this.task(clientId, taskId);
    const permission = upload ? 'files.write' : 'files.read';
    if (!grant.permissions.includes(permission) || !task.capabilities.includes(permission)) {
      throw new BasicToolError('FORBIDDEN', 'Transfer requires file permission on this task.');
    }
    const expiresAt = task.createdAt + 1800000;
    if (
      active &&
      (task.state !== 'active' || task.quarantined || Date.now() >= expiresAt || this.running.has(taskId))
    ) {
      throw new BasicToolError('TASK_INTERRUPTED', 'Task cannot admit transfer work.');
    }
    if (touch) {
      task.updatedAt = Date.now();
    }
    return { expiresAt };
  }

  /**
   * Routes transfer control through the same authenticated Runtime as ordinary tools.
   */
  async transferControl(clientId: string, name: TransferControlName, input: unknown) {
    this.requireGrant(clientId);
    if (!this.transfers) {
      throw new BasicToolError('TRANSFER_UNAVAILABLE', 'File transfer is unavailable.');
    }
    if (name === 'file_upload_prepare' || name === 'file_download_prepare') {
      const parsed = transferControlSchemas[name].parse(input);
      this.transferContext(clientId, parsed.taskId, name === 'file_upload_prepare', false, false);
      const task = this.task(clientId, parsed.taskId);
      const fingerprint = digest({ name, input: parsed });
      const prior = task.operations.find((operation) => operation.key === parsed.idempotencyKey);
      if (prior && (prior.tool !== name || prior.fingerprint !== fingerprint)) {
        throw new BasicToolError('REQUEST_CONFLICT', 'The operation key has different tool input.');
      }
      if (!prior) {
        this.transferContext(clientId, parsed.taskId, name === 'file_upload_prepare', true, false);
        if (task.operations.length >= 1000) {
          throw new BasicToolError('TASK_LIMIT', 'Task operation history reached its limit.');
        }
        task.operations.push({ key: parsed.idempotencyKey, tool: name, fingerprint, state: 'pending' });
        this.browser?.invalidate(task.taskId);
      }
      // Flush even an existing pending reservation, including a concurrent identical request.
      await this.store.saveTask(task);
    }
    const value = await this.transfers.control(clientId, name, input);
    if (name === 'file_upload_prepare' || name === 'file_download_prepare') {
      const task = this.task(clientId, value.taskId);
      const operation = task.operations.find(
        (item) => item.key === transferControlSchemas[name].parse(input).idempotencyKey
      )!;
      operation.state = 'completed';
      operation.version = value.transferId;
      await this.store.saveTask(task);
    }
    if (value.status === 'unknown') {
      const task = this.task(clientId, value.taskId);
      task.quarantined = true;
      await this.store.saveTask(task);
    }
    this.requireGrant(clientId);
    return value;
  }
  private active: string | null = null;
  private readonly recoveredTasks: ReadonlySet<string>;
  private approvals = 0;
  private readonly persistedRevocations = new Set<string>();
  private readonly preparing = new Map<string, Promise<unknown>>();
  private readonly stopping = new Map<string, Promise<unknown>>();
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly timer: ReturnType<typeof setInterval>;
  private closing = false;

  /**
   * Shares the production BasicTools service; a retained quarantine keeps global admission closed.
   */
  constructor(
    private readonly tools: BasicTools,
    private readonly store: ControlStore,
    private readonly computer?: ComputerTools,
    private readonly browser?: BrowserTools,
    private readonly device?: DeviceIdentity
  ) {
    // Recovered tasks have durable summaries but no live BasicTools registration in this Runtime.
    this.recoveredTasks = new Set(store.tasks.keys());
    for (const grant of store.grants.values()) {
      if (grant.revoked) {
        this.persistedRevocations.add(grant.clientId);
      }
    }
    const unresolved = [...store.tasks.values()].filter((task) => task.quarantined);
    this.active = unresolved[0]?.taskId ?? null;
    this.timer = setInterval(() => {
      void this.expire().catch(() => {
        this.closing = true;
      });
    }, 1000);
    this.timer.unref();
  }

  /**
   * Creates one device-scoped capability token only from trusted Host approval; remote tools cannot grant access.
   */
  async approve(input: ApprovalInput): Promise<{ grant: Grant; token: string }> {
    if (
      input.permissions.some((permission) => permission.startsWith('computer.')) &&
      !this.computer?.available()
    ) {
      throw new BasicToolError(
        'COMPUTER_UNAVAILABLE',
        'Computer permissions require the managed local backend.'
      );
    }
    if (this.closing || this.store.grants.size + this.approvals >= 100) {
      throw new BasicToolError('GRANT_LIMIT', 'The local grant limit was reached.');
    }
    this.approvals++;
    try {
      const permissions = [
        ...new Set<ExecutorPermission>([
          ...input.permissions,
          ...(input.permissions.includes('files.write') ? ['files.read' as const] : []),
        ]),
      ];
      const token = randomBytes(32).toString('hex');
      const grant: Grant = {
        clientId: randomUUID(),
        scope: 'device',
        label: input.label,
        permissions,
        waitBudgetMs: input.waitBudgetMs,
        revoked: false,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      };
      await this.store.saveGrant(grant);
      return { grant: structuredClone(grant), token };
    } finally {
      this.approvals--;
    }
  }

  /**
   * Authenticates every HTTP request with a bounded token; sessions and clientInfo do not grant identity.
   */
  authenticate(token: string): Grant {
    if (!/^[a-f0-9]{64}$/.test(token) || this.closing) {
      throw new BasicToolError('UNAUTHORIZED', 'The local credential is invalid.');
    }
    const hash = createHash('sha256').update(token).digest();
    const grant = [...this.store.grants.values()].find(
      (item) => !item.revoked && timingSafeEqual(hash, Buffer.from(item.tokenHash, 'hex'))
    );
    if (!grant) {
      throw new BasicToolError('UNAUTHORIZED', 'The local credential is invalid or revoked.');
    }
    return structuredClone(grant);
  }

  /**
   * Rechecks authorization after asynchronous work and before delivering sensitive results.
   */
  requireGrant(clientId: string): Grant {
    const grant = this.store.grants.get(clientId);
    if (!grant || grant.revoked || this.closing) {
      throw new BasicToolError('UNAUTHORIZED', 'The local credential is unavailable.');
    }
    return grant;
  }

  /**
   * Lists Host-visible grant summaries without returning token material or digests to the Renderer.
   */
  clients() {
    return [...this.store.grants.values()].map((grant) => clientSummarySchema.strip().parse(grant));
  }

  /**
   * Projects only currently verified Computer tools allowed by the current grant; calls still recheck task permission.
   */
  computerTools(clientId: string): Partial<typeof computerSchemas> {
    const grant = this.requireGrant(clientId);
    if (!this.computer?.available()) {
      return {};
    }
    return grant.permissions.includes('computer.control') ? computerSchemas : {};
  }

  /**
   * Projects the finite Browser tools only for an explicitly approved browser grant.
   */
  browserTools(clientId: string): Partial<typeof browserSchemas> {
    return this.browser && this.requireGrant(clientId).permissions.includes('browser') ? browserSchemas : {};
  }
  /**
   * Lists only authorized browser candidates and site-permitted tabs; no desktop task is created.
   */
  async discoverBrowser(clientId: string, name: 'browser_list' | 'browser_tabs', input: unknown) {
    if (!this.browser || !this.requireGrant(clientId).permissions.includes('browser')) {
      throw new BasicToolError('FORBIDDEN', 'Browser permission has not been granted.');
    }
    const result = await this.browser.discover(name, input);
    this.requireGrant(clientId);
    return result;
  }
  /**
   * Exposes this client's device capabilities, default execution directory and own active task to MCP.
   */
  status(clientId: string) {
    const grant = this.requireGrant(clientId);
    const task = this.active ? this.store.tasks.get(this.active) : undefined;
    return {
      ...(this.device ? { device: { ...this.device } } : {}),
      protocolVersion: '2025-11-25',
      transferLimits: this.transfers?.settings() ?? null,
      capabilities: [...grant.permissions],
      shell: this.tools.shellStatus(),
      browser: { available: this.browser?.available() ?? false },
      computer: {
        available: this.computer?.available() ?? false,
        backend: this.computer?.backendStatus() ?? null,
      },
      authorization: { scope: grant.scope, clientId },
      defaultCwd: homedir(),
      task: task?.clientId === clientId ? this.publicTask(task) : null,
      waitBudgetMs: grant.waitBudgetMs,
    };
  }

  /**
   * Revokes delivery immediately, persists the revocation, then drains this owner's active task.
   */
  async revoke(clientId: string): Promise<void> {
    const grant = this.store.grants.get(clientId);
    if (!grant) {
      return;
    }
    if (!this.persistedRevocations.has(clientId)) {
      grant.revoked = true;
      await this.store.saveGrant(grant);
      this.persistedRevocations.add(clientId);
    }
    for (const task of this.store.tasks.values()) {
      if (task.clientId !== clientId) {
        continue;
      }
      if (['created', 'active', 'stopping'].includes(task.state)) {
        await this.stop(clientId, task.taskId, true);
      }
      await this.tools.revokeOutput(clientId, task.taskId);
    }
  }

  /**
   * Reserves global admission synchronously, persists the creation key, then registers the approved scope.
   */
  async start(clientId: string, request: unknown) {
    const input = taskStartSchema.parse(request);
    const grant = this.requireGrant(clientId);
    const capabilities = [
      ...new Set<ExecutorPermission>([
        ...input.capabilities,
        ...(input.capabilities.includes('files.write') ? ['files.read' as const] : []),
      ]),
    ].sort();
    if (!capabilities.every((cap) => grant.permissions.includes(cap))) {
      throw new BasicToolError(
        'FORBIDDEN',
        'The requested capabilities have not been granted on this device.'
      );
    }
    const previous = [...this.store.tasks.values()].find(
      (task) => task.clientId === clientId && task.creationKey === input.idempotencyKey
    );
    let connectionId: string | undefined;
    if (capabilities.includes('browser')) {
      connectionId = previous
        ? (input.connectionId ?? previous.connectionId)
        : this.browser?.select(input.connectionId);
    }
    if (capabilities.includes('browser') && !connectionId) {
      throw new BasicToolError('BROWSER_OFFLINE', 'No browser backend is available.');
    }
    const fingerprint = digest({ capabilities, cwd: input.cwd, connectionId });
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new BasicToolError('REQUEST_CONFLICT', 'The creation key has different input.');
      }
      await this.preparing.get(previous.taskId);
      this.requireGrant(clientId);
      return this.publicTask(previous);
    }
    if (this.active) {
      throw new BasicToolError(
        'RESOURCE_BUSY',
        'Another task or recovery barrier holds execution admission.'
      );
    }
    if (capabilities.includes('computer.control') && !this.computer?.available()) {
      if (!this.computer) {
        throw new BasicToolError('COMPUTER_UNAVAILABLE', 'Desktop backend is unavailable.');
      }
      await this.computer.restart();
      this.requireGrant(clientId);
      if (this.active) {
        throw new BasicToolError('RESOURCE_BUSY', 'Another task was admitted during startup.');
      }
    }
    if (this.store.tasks.size >= 1000) {
      throw new BasicToolError('TASK_LIMIT', 'Retained task history reached its limit.');
    }
    const task: TaskRecord = {
      taskId: randomUUID(),
      clientId,
      creationKey: input.idempotencyKey,
      fingerprint,
      ...(connectionId ? { connectionId } : {}),
      capabilities,
      cwd: resolveLocalPath(input.cwd, homedir()),
      state: 'created',
      quarantined: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      operations: [],
    };
    this.active = task.taskId;
    this.store.tasks.set(task.taskId, task);
    const pending = this.prepare(clientId, task);
    this.preparing.set(task.taskId, pending);
    try {
      return await pending;
    } finally {
      this.preparing.delete(task.taskId);
    }
  }

  /**
   * Drains preparation before releasing admission, including registration completed after a stop request.
   */
  private async prepare(clientId: string, task: TaskRecord) {
    let registered = false;
    try {
      await this.store.saveTask(task);
      this.requireGrant(clientId);
      if (task.state !== 'created') {
        throw new BasicToolError('TASK_STOPPED', 'Task preparation was stopped.');
      }
      await this.tools.registerTask({
        taskId: task.taskId,
        ownerId: clientId,
        cwd: task.cwd,
        permissions: task.capabilities.flatMap((permission) => {
          const parsed = basicPermissionSchema.safeParse(permission);
          return parsed.success ? [parsed.data] : [];
        }),
      });
      registered = true;
      this.requireGrant(clientId);
      if (task.state !== 'created') {
        throw new BasicToolError('TASK_STOPPED', 'Task preparation was stopped.');
      }
      task.state = 'active';
      task.updatedAt = Date.now();
      await this.store.saveTask(task);
      this.requireGrant(clientId);
      if (task.state !== 'active') {
        throw new BasicToolError('TASK_STOPPED', 'Task preparation was stopped.');
      }
      if (task.capabilities.some((capability) => capability.startsWith('computer.'))) {
        this.computer?.startTask(task.taskId);
      }
      return this.publicTask(task);
    } catch (error) {
      if (registered) {
        try {
          await this.tools.stopTask(clientId, task.taskId);
        } catch {
          task.quarantined = true;
        }
      }
      if (task.state !== 'stopping') {
        task.state = 'failed';
        task.updatedAt = Date.now();
        try {
          await this.store.saveTask(task);
          if (!task.quarantined) {
            this.active = null;
          }
        } catch {
          task.quarantined = true;
        }
      }
      throw error;
    }
  }

  /**
   * Finds only owner-bound lifecycle and sanitized operation metadata; queries never execute a tool.
   */
  taskStatus(clientId: string, request: unknown) {
    this.requireGrant(clientId);
    const input = taskStatusSchema.parse(request);
    let task: TaskRecord | undefined;
    if ('taskId' in input) {
      task = this.task(clientId, input.taskId);
    } else if ('creationKey' in input) {
      task = [...this.store.tasks.values()].find(
        (record) => record.clientId === clientId && record.creationKey === input.creationKey
      );
    } else if (this.active) {
      task = this.store.tasks.get(this.active);
    }
    if (!task || task.clientId !== clientId) {
      return { task: null };
    }
    return {
      task: this.publicTask(task),
      operation:
        'operationKey' in input && input.operationKey
          ? structuredClone(task.operations.find((item) => item.key === input.operationKey) ?? null)
          : null,
    };
  }

  /**
   * Stops the sole admitted desktop task from the trusted local Host, including revoked or uncertain tasks.
   * The owning Runtime separately closes the fixed backend; recorded unknown effects remain quarantined.
   */
  async stopComputerUse(): Promise<void> {
    const task = this.active ? this.store.tasks.get(this.active) : undefined;
    if (task?.capabilities.some((capability) => capability.startsWith('computer.'))) {
      await this.stop(task.clientId, task.taskId, true);
    }
  }

  /**
   * Cancels Basic admission and waits through operation persistence before releasing the global lock.
   */
  async stop(clientId: string, taskId: string, revoked = false) {
    if (!revoked) {
      this.requireGrant(clientId);
    }
    const task = this.task(clientId, taskId);
    if (
      !['created', 'active', 'stopping'].includes(task.state) &&
      !(task.quarantined && task.capabilities.includes('computer.control'))
    ) {
      return this.publicTask(task);
    }
    const existing = this.stopping.get(taskId);
    if (existing) {
      await existing;
      return this.publicTask(task);
    }
    task.state = 'stopping';
    task.updatedAt = Date.now();
    const pending = this.drain(clientId, task);
    this.stopping.set(taskId, pending);
    try {
      await pending;
      this.stopping.delete(taskId);
      return this.publicTask(task);
    } finally {
      this.stopping.delete(taskId);
    }
  }

  /**
   * Waits for registration and operation persistence; only confirmed quiescence releases admission.
   */
  private async drain(clientId: string, task: TaskRecord): Promise<void> {
    try {
      await this.store.saveTask(task);
      await this.transfers?.stopTask(task.taskId);
      if (task.capabilities.includes('computer.control')) {
        await this.computer?.close();
      }
      await this.preparing.get(task.taskId)?.catch(() => {});
      try {
        await this.tools.stopTask(clientId, task.taskId);
      } catch (error) {
        if (!(error instanceof BasicToolError) || error.code !== 'TASK_NOT_FOUND') {
          throw error;
        }
      }
      await this.running.get(task.taskId)?.catch(() => {});
      await this.browser?.release(task.taskId);
      const onlyComputerUnknown =
        task.operations.some((op) => op.state === 'unknown' && Object.hasOwn(computerSchemas, op.tool)) &&
        task.operations.every(
          (op) => !['pending', 'unknown'].includes(op.state) || Object.hasOwn(computerSchemas, op.tool)
        );
      if (
        task.quarantined &&
        onlyComputerUnknown &&
        !this.transfers?.active(task.taskId) &&
        this.computer?.executionStopped() &&
        this.tools.taskStatus(clientId, task.taskId).state !== 'isolated'
      ) {
        task.quarantined = false;
      }
      task.state = 'cancelled';
      task.updatedAt = Date.now();
      await this.store.saveTask(task);
      this.computer?.release(task.taskId);
      if (!task.quarantined && this.active === task.taskId) {
        this.active = null;
      }
    } catch (error) {
      task.quarantined = true;
      throw error;
    }
  }

  /**
   * Ends an idle task only; uncertain operations retain global admission for inspection.
   */
  async end(clientId: string, taskId: string) {
    this.requireGrant(clientId);
    const task = this.task(clientId, taskId);
    if (this.running.has(taskId) || this.transfers?.active(taskId)) {
      throw new BasicToolError('ACTION_IN_PROGRESS', 'A tool call is still in progress.');
    }
    if (task.quarantined) {
      throw new BasicToolError('TASK_ISOLATED', 'Task recovery requires inspection.');
    }
    if (task.state !== 'active') {
      return this.publicTask(task);
    }
    task.state = 'stopping';
    task.updatedAt = Date.now();
    const pending = this.finish(clientId, task);
    this.stopping.set(taskId, pending);
    try {
      await pending;
      this.stopping.delete(taskId);
      return this.publicTask(task);
    } finally {
      this.stopping.delete(taskId);
    }
  }

  /**
   * Serializes completion with concurrent stop requests and retains admission on persistence failure.
   */
  private async finish(clientId: string, task: TaskRecord): Promise<void> {
    try {
      await this.store.saveTask(task);
      await this.tools.stopTask(clientId, task.taskId);
      await this.browser?.release(task.taskId);
      if (task.capabilities.includes('computer.control')) {
        await this.computer?.close();
      }
      task.state = 'completed';
      task.updatedAt = Date.now();
      await this.store.saveTask(task);
      this.computer?.release(task.taskId);
      this.active = null;
    } catch (error) {
      task.quarantined = true;
      throw error;
    }
  }

  /**
   * Validates task capability, rejects concurrent actions and binds explicit MCP cancellation to task stop.
   * Recovered completed file mutations return durable effect/version summaries without reopening their targets.
   */
  async call(
    clientId: string,
    name: ToolName,
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<unknown> {
    const grant = this.requireGrant(clientId);
    const task = this.task(clientId, String(input.taskId));
    const isComputer = Object.hasOwn(computerSchemas, name);
    const isBrowser = Object.hasOwn(browserSchemas, name);
    let permission: ExecutorPermission;
    if (isBrowser) {
      permission = 'browser';
    } else if (isComputer) {
      permission = 'computer.control';
    } else if (name === 'powershell') {
      permission = 'shell.execute';
    } else if (name === 'write' || name === 'edit') {
      permission = 'files.write';
    } else {
      permission = 'files.read';
    }
    const outputRead =
      name === 'read' && typeof input.path === 'string' && input.path.startsWith('executor-output:');
    if (
      !task.capabilities.includes(outputRead ? 'shell.execute' : permission) ||
      !grant.permissions.includes(outputRead ? 'shell.execute' : permission)
    ) {
      throw new BasicToolError('FORBIDDEN', 'The task or current grant does not allow this tool.');
    }
    if (this.running.has(task.taskId) || this.transfers?.active(task.taskId)) {
      throw new BasicToolError('ACTION_IN_PROGRESS', 'This task already has a tool call in progress.');
    }
    const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : null;
    const fingerprint = digest({ name, input });
    const previous = key ? task.operations.find((item) => item.key === key) : undefined;
    if (previous && (previous.tool !== name || previous.fingerprint !== fingerprint)) {
      throw new BasicToolError('REQUEST_CONFLICT', 'The operation key has different tool input.');
    }
    if (task.state !== 'active' && !(outputRead || previous?.state === 'completed')) {
      throw new BasicToolError('TASK_INTERRUPTED', 'This task is not accepting new operations.');
    }
    if (task.quarantined && !previous) {
      throw new BasicToolError('TASK_ISOLATED', 'This task requires recovery inspection.');
    }
    if (previous && previous.state !== 'completed') {
      throw new BasicToolError(
        'OPERATION_RETAINED',
        'Inspect the retained operation outcome; it cannot be replayed.'
      );
    }
    if ((isComputer || isBrowser) && previous) {
      return { retained: true, businessEffect: previous.effect, code: previous.code };
    }
    if (previous && (name === 'write' || name === 'edit') && this.recoveredTasks.has(task.taskId)) {
      // Authorization and the original input fingerprint were checked above; no file is reopened or changed.
      return { retained: true, fileEffect: previous.effect, version: previous.version };
    }
    if (signal.aborted) {
      throw new BasicToolError('REQUEST_CANCELLED', 'The request was cancelled before admission.');
    }
    const operation = previous ?? (key ? { key, tool: name, fingerprint, state: 'pending' as const } : null);
    if (operation && !previous) {
      if (task.operations.length >= 1000) {
        throw new BasicToolError('TASK_LIMIT', 'Task operation history reached its limit.');
      }
      task.operations.push(operation);
    }
    /**
     * Stops the whole Basic task on explicit cancellation; closing an HTTP response does not invoke this hook.
     */
    const cancel = () => {
      void this.stop(clientId, task.taskId, true).catch(() => {
        task.quarantined = true;
      });
    };
    signal.addEventListener('abort', cancel, { once: true });
    const requestDeadlineMs = Math.min(Date.now() + grant.waitBudgetMs, task.createdAt + 1800000);
    const pending = this.execute(clientId, grant, task, name, input, operation, requestDeadlineMs);
    this.running.set(task.taskId, pending);
    try {
      const value = await pending;
      this.requireGrant(clientId);
      return value;
    } finally {
      signal.removeEventListener('abort', cancel);
      this.running.delete(task.taskId);
    }
  }

  /**
   * Stops admission, drains the current task and closes the control writer; BasicTools remains owned by Runtime.
   */
  async close(): Promise<void> {
    clearInterval(this.timer);
    this.closing = true;
    try {
      if (this.active) {
        const task = this.store.tasks.get(this.active);
        if (task && ['created', 'active', 'stopping'].includes(task.state)) {
          await this.stop(task.clientId, task.taskId, true);
        }
      }
    } finally {
      await this.store.close();
    }
  }

  /**
   * Enters a tool only after durable admission and stores a sanitized terminal summary.
   */
  private async execute(
    clientId: string,
    grant: Grant,
    task: TaskRecord,
    name: ToolName,
    input: Record<string, unknown>,
    operation: TaskRecord['operations'][number] | null,
    requestDeadlineMs: number
  ): Promise<unknown> {
    const recording = operation?.state === 'pending';
    try {
      this.requireGrant(clientId);
      let effective = input;
      if (name === 'powershell') {
        const requested = shellInputSchema.parse(input);
        const remaining = Math.min(grant.waitBudgetMs, task.createdAt + 1800000 - Date.now()) - 10000;
        if (!operation?.effectiveTimeout && remaining < 1000) {
          throw new BasicToolError('TASK_EXPIRED', 'The task has insufficient execution budget.');
        }
        const timeout =
          operation?.effectiveTimeout ?? Math.min(requested.timeout, Math.floor(remaining / 1000));
        if (operation) {
          operation.effectiveTimeout = timeout;
        }
        effective = { ...requested, timeout };
      }
      if (operation && operation.state === 'pending') {
        await this.store.saveTask(task);
      }
      this.requireGrant(clientId);
      if (task.state !== 'active' && operation?.state === 'pending') {
        throw new BasicToolError('TASK_STOPPED', 'Task admission was stopped.');
      }
      const isComputer = Object.hasOwn(computerSchemas, name);
      const isBrowser = Object.hasOwn(browserSchemas, name);
      if (!isBrowser) {
        this.browser?.invalidate(task.taskId);
      }
      if (isBrowser && effective.connectionId && effective.connectionId !== task.connectionId) {
        throw new BasicToolError('FORBIDDEN', 'Browser connection does not match the task binding.');
      }
      let value: unknown;
      if (isBrowser) {
        value = await this.browser?.call(clientId, task.taskId, name as BrowserName, {
          ...effective,
          connectionId: task.connectionId,
        });
      } else if (isComputer) {
        value = await this.computer?.call(task.taskId, name as ComputerName, effective, {
          deadlineMs: requestDeadlineMs,
        });
      } else {
        value = await this.tools[name as BasicName](clientId, effective);
      }
      if (isComputer && !this.computer) {
        throw new BasicToolError('COMPUTER_UNAVAILABLE', 'The managed local desktop backend is unavailable.');
      }
      const outcome = value && typeof value === 'object' ? value : {};
      if (operation && recording) {
        operation.state = 'completed';
        if ('fileEffect' in outcome && typeof outcome.fileEffect === 'string') {
          operation.effect = outcome.fileEffect;
        }
        if ('businessEffect' in outcome && typeof outcome.businessEffect === 'string') {
          operation.effect = outcome.businessEffect;
        }
        if ((isComputer || isBrowser) && 'code' in outcome && typeof outcome.code === 'string') {
          operation.code = outcome.code;
        }
        if ('version' in outcome && typeof outcome.version === 'string') {
          operation.version = outcome.version;
        }
        if (isBrowser && operation.effect === 'unknown') {
          operation.state = 'unknown';
        }
        if (
          operation.effect === 'unknown' &&
          (isComputer || this.tools.taskStatus(clientId, task.taskId).state === 'isolated')
        ) {
          task.quarantined = true;
          if (isComputer) {
            operation.state = 'unknown';
          }
        }
        task.updatedAt = Date.now();
        await this.store.saveTask(task);
      } else {
        task.updatedAt = Date.now();
      }
      return value;
    } catch (error) {
      try {
        task.quarantined ||= this.tools.taskStatus(clientId, task.taskId).state === 'isolated';
      } catch {
        /* Registration may not exist after restart. */
      }
      if (operation && recording) {
        operation.state = 'failed';
        operation.code = error instanceof BasicToolError ? error.code : 'TOOL_FAILED';
        if (operation.code === 'COMPUTER_OBSERVATION_INTERRUPTED') {
          operation.state = 'unknown';
          operation.effect = 'not_applied';
        }
        if (operation.code === 'COMPUTER_RESULT_UNKNOWN' || operation.code === 'OUTCOME_UNKNOWN') {
          operation.state = 'unknown';
          operation.effect = 'unknown';
        }
        if (
          [
            'SHELL_SUPERVISION_LOST',
            'SHELL_RESULT_UNKNOWN',
            'CONTROL_STORE_FAILED',
            'FILE_RECOVERY_REQUIRED',
            'COMPUTER_RESULT_UNKNOWN',
            'COMPUTER_OBSERVATION_INTERRUPTED',
          ].includes(operation.code)
        ) {
          task.quarantined = true;
        }
        task.updatedAt = Date.now();
        await this.store.saveTask(task);
      }
      throw error;
    }
  }

  /**
   * Hides foreign task existence; the public DTO excludes raw commands and operation contents.
   */
  private task(clientId: string, taskId: string): TaskRecord {
    const task = this.store.tasks.get(taskId);
    if (!task || task.clientId !== clientId) {
      throw new BasicToolError('TASK_NOT_FOUND', 'No task is authorized for this client.');
    }
    return task;
  }

  /**
   * Returns detached lifecycle metadata with the fixed execution directory, without private fingerprints.
   */
  private publicTask(task: TaskRecord) {
    return {
      taskId: task.taskId,
      state:
        this.stopping.has(task.taskId) && ['cancelled', 'completed'].includes(task.state)
          ? 'stopping'
          : task.state,
      quarantined: task.quarantined,
      browserActionsMayContinue: task.operations.some(
        (operation) =>
          operation.tool.startsWith('browser_') && ['pending', 'unknown'].includes(operation.state)
      ),
      cwd: task.cwd,
      capabilities: [...task.capabilities],
      ...(task.connectionId ? { connectionId: task.connectionId } : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      creationKeyRetention:
        'Retained until the bounded control journal is explicitly retired; no automatic key reuse.',
    };
  }

  /**
   * Stops expired tasks while counting a running call as activity, without extending total lifetime.
   */
  private async expire(): Promise<void> {
    if (!this.active || this.closing) {
      return;
    }
    const task = this.store.tasks.get(this.active);
    if (!task || task.state !== 'active') {
      return;
    }
    if (
      Date.now() - task.createdAt >= 1800000 ||
      (!this.running.has(task.taskId) &&
        !this.transfers?.working(task.taskId) &&
        Date.now() - task.updatedAt >= 300000)
    ) {
      await this.stop(task.clientId, task.taskId, true);
    }
  }
}
