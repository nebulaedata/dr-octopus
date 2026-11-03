/**
 * @author Codex
 * @description Accepts finite messages only from the extension in the isolated top document and owns BFCache cleanup.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { RecordingContent } from '../src/lib/recording/recording-content';
import { PageControllerAdapter } from '../src/page-controller-adapter';
import { pageOwnerSchema } from '../src/page-commands';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_end',
  world: 'ISOLATED',
  allFrames: false,
  /**
   * Registers one isolated receiver and cleans resources when the context becomes invalid.
   */
  main(ctx) {
    const owner = globalThis as typeof globalThis & { __octopusPageReceiver?: object };
    if (owner.__octopusPageReceiver) {
      return;
    }
    const receiverOwner = {};
    owner.__octopusPageReceiver = receiverOwner;
    const adapter = new PageControllerAdapter();
    const recording = new RecordingContent();
    /**
     * Rejects foreign senders; ping establishes document identity without executing an action.
     */
    const receive = (message: unknown, sender: { id?: string }) => {
      if (sender.id !== browser.runtime.id) {
        return;
      }
      let ownerInput: unknown = null;
      if (message && typeof message === 'object') {
        if ('localRunId' in message && !('connectionId' in message)) {
          ownerInput = { localRunId: message.localRunId };
        } else if ('connectionId' in message && !('localRunId' in message)) {
          ownerInput = { connectionId: message.connectionId };
        }
      }
      const authority = pageOwnerSchema.safeParse(ownerInput);
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'page.release-if-idle' &&
        'taskId' in message &&
        typeof message.taskId === 'string' &&
        authority.success
      ) {
        return Promise.resolve(adapter.releaseIfIdle(message.taskId, authority.data));
      }
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        typeof message.type === 'string' &&
        message.type.startsWith('recorder.')
      ) {
        return recording.receive(message);
      }
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'page.ping' &&
        authority.success &&
        'documentRevision' in message &&
        typeof message.documentRevision === 'string'
      ) {
        adapter.bind(
          authority.data,
          message.documentRevision,
          'taskId' in message && typeof message.taskId === 'string' ? message.taskId : undefined
        );
        return adapter.identity();
      }
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'page.release' &&
        'taskId' in message &&
        typeof message.taskId === 'string' &&
        authority.success
      ) {
        adapter.endTask(message.taskId, authority.data);
        return Promise.resolve({ released: true });
      }
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        ['page.snapshot-check', 'page.screenshot-begin', 'page.screenshot-end'].includes(
          String(message.type)
        ) &&
        'snapshotId' in message &&
        typeof message.snapshotId === 'string' &&
        'controllerId' in message &&
        typeof message.controllerId === 'string' &&
        'documentId' in message &&
        typeof message.documentId === 'string'
      ) {
        const valid =
          message.type === 'page.screenshot-begin'
            ? adapter.beginScreenshot(message.snapshotId, message.controllerId, message.documentId)
            : adapter.snapshotCurrent(message.snapshotId, message.controllerId, message.documentId);
        if (message.type === 'page.screenshot-end') {
          adapter.finishScreenshot();
        }
        return Promise.resolve({ valid });
      }
      return adapter.execute(message).then(
        (result) => ({ result }),
        (error) => ({ error: error instanceof Error ? error.message : 'ACTION_FAILED' })
      );
    };
    browser.runtime.onMessage.addListener(receive);
    void recording.hello();
    ctx.addEventListener(window, 'pagehide', () => {
      adapter.reset(false);
      recording.pagehide();
    });
    ctx.addEventListener(window, 'pageshow', (event) => {
      if (event.persisted) {
        adapter.reset(true);
        recording.pageshow();
      }
    });
    ctx.onInvalidated(() => {
      adapter.dispose();
      recording.dispose();
      browser.runtime.onMessage.removeListener(receive);
      if (owner.__octopusPageReceiver === receiverOwner) {
        delete owner.__octopusPageReceiver;
      }
    });
  },
});
