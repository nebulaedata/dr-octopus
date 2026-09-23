/**
 * @author Codex
 * @description Executes a fenced manual restart while keeping process safety separate from Coordinator wiring.
 */
import { ApplicationError } from '../errors/application-error.js';
import { SessionRuntimeError } from './errors.js';
import type { RestartSessionBody } from '@octopus/shared/protocol';
import type { SessionRuntimeSlot } from './runtime-slot.js';
import type { SessionRuntimeBinding } from './types.js';

interface RestartRuntimeOptions {
  slot: SessionRuntimeSlot;
  request: RestartSessionBody;
  timeoutMs: number;
  /**
   * Stops the owned process and confirms its exit before resolving.
   */
  stop(runtimeId: string): Promise<void>;
  /**
   * Checks cancellation before starting and before publishing the replacement.
   */
  activate(assertLive: () => void): Promise<SessionRuntimeBinding>;
  /**
   * Invalidates the Host's Session business projection.
   */
  publish(): void;
}

/**
 * Shares one restart per target generation, pauses new work and preserves the original Session file.
 */
export function restartSessionRuntime(options: RestartRuntimeOptions): Promise<SessionRuntimeBinding> {
  const { slot, request } = options;
  return slot.lifecycle.restart(
    request,
    async (assertLive) => {
      await slot.settleActivation();
      assertLive();
      const runtime = slot.getRuntime();
      const binding = runtime?.getBinding();
      const expected = request.expectedRuntime;
      if (
        expected === null
          ? binding !== undefined
          : binding?.runtimeId !== expected.runtimeId || binding?.epoch !== expected.epoch
      ) {
        throw new SessionRuntimeError('SESSION_RUNTIME_BINDING_MISMATCH', '会话进程已变化，请刷新后重试。');
      }
      if (runtime) {
        runtime.suspendOperations();
        let stopping = false;
        try {
          const drained = await runtime.waitForDrain(10_000);
          assertLive();
          if (!request.allowInterrupt && (!drained || !runtime.isSafelyReclaimable())) {
            throw new ApplicationError('SESSION_BUSY', '当前任务或交互尚未结束，重启将中断任务。', {
              statusCode: 409,
            });
          }
          stopping = true;
          await options.stop(runtime.getBinding().runtimeId);
        } finally {
          if (!stopping) {
            runtime.resumeOperations();
          }
        }
      }
      assertLive();
      return options.activate(assertLive);
    },
    () => options.publish(),
    options.timeoutMs
  );
}
