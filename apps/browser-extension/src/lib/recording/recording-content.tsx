/**
 * @author Codex
 * @description Owns the single document recorder, bounded acknowledged transport and isolated toolbar root.
 */
import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { DOMRecorder } from './dom-recorder';
import {
  recordingError,
  recordingLimits,
  type RecordingFact,
  type RecordingReply,
  type RecordingSession,
  type RecordingHello,
} from './recording-contract';
// 直接引用浮条组件：统一入口会将 Popup 组件计入 WXT 内容脚本依赖，
// 导致修改 Popup 时重载内容脚本，刷新所有匹配的 HTTP/HTTPS 标签页。
import { RecordingToolbar } from '../../features/recording/RecordingToolbar';
import styles from '../../../entrypoints/popup/style.css?inline';

export class RecordingContent {
  private session: RecordingSession | null = null;
  private host?: HTMLElement;
  private root?: Root;
  private recorder?: DOMRecorder;
  private events: RecordingFact[] = [];
  private pending?: Promise<void>;
  private batch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private error = '';
  private disposed = false;
  private held = false;
  private generation = 0;
  private helloRevision = 0;

  /**
   * Requests authoritative membership without reading or writing other tabs' state.
   */
  hello = async (): Promise<void> => {
    if (this.disposed) {
      return;
    }
    const generation = this.generation;
    const revision = ++this.helloRevision;
    try {
      const result: RecordingReply<RecordingHello> = await browser.runtime.sendMessage({
        type: 'recorder.hello',
      });
      if (this.disposed || generation !== this.generation || revision !== this.helloRevision) {
        return;
      }
      if (result?.ok) {
        this.held = false;
        this.configure(result.value.session, result.value.lastBatch);
      } else if (!result?.ok && this.session) {
        this.held = true;
        this.recorder?.stop();
        this.error = recordingError(result?.error ?? 'RECORDING_DELIVERY');
        this.render();
      }
    } catch {
      if (generation !== this.generation || this.disposed || revision !== this.helloRevision) {
        return;
      }
      this.error = '录制服务暂不可用，请重新打开插件查看状态。';
      this.render();
    }
  };

  /**
   * Handles only finite recorder messages through the existing content receiver.
   */
  receive(message: unknown): Promise<unknown> | undefined {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }
    if (message.type === 'recorder.probe') {
      void this.hello();
      return Promise.resolve({ ready: true });
    }
    if (message.type === 'recorder.state' && 'session' in message) {
      const session = message.session as RecordingSession | null;
      // A terminal notification has no producer identity; re-read authority before clearing newer UI.
      if (!session || !this.session || this.session.id !== session.id) {
        void this.hello();
      } else {
        this.configure(session);
      }
      return Promise.resolve({ received: true });
    }
    if (
      message.type === 'recorder.flush' &&
      'sessionId' in message &&
      message.sessionId === this.session?.id
    ) {
      this.held = true;
      this.recorder?.stop();
      return this.flushAll().then(
        () => ({ flushed: this.events.length === 0 && !this.error }),
        () => ({ flushed: false })
      );
    }
  }

  /**
   * Updates projection and capture listeners without reinitializing the document producer on every ACK.
   */
  private configure(session: RecordingSession | null, lastBatch?: number): void {
    if (this.disposed) {
      return;
    }
    if (!session) {
      this.cleanup();
      return;
    }
    if (
      this.session?.id === session.id &&
      (session.epoch < this.session.epoch || session.updatedAt < this.session.updatedAt)
    ) {
      return;
    }
    const changed = this.session?.id !== session.id;
    const epochChanged = this.session?.epoch !== session.epoch;
    if (epochChanged && session.status === 'recording' && lastBatch === undefined) {
      // Only hello binds this document to its committed cursor; state broadcasts cover all tabs.
      this.held = true;
      this.recorder?.stop();
      void this.hello();
      return;
    }
    if (changed) {
      this.cleanup();
      this.batch = 0;
      this.error = '';
    }
    if (epochChanged) {
      if (!changed) {
        this.generation++;
      }
      this.pending = undefined;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      this.held = false;
      this.events = [];
      this.batch = lastBatch ?? this.batch;
      if (session.status === 'recording') {
        this.error = '';
      }
    } else if (lastBatch !== undefined && !this.pending && this.events.length === 0) {
      this.batch = Math.max(this.batch, lastBatch);
    }
    this.session = session;
    if (!this.host) {
      const host = document.createElement('div');
      host.setAttribute('data-octopus-recorder', '');
      host.setAttribute('data-page-agent-ignore', '');
      host.setAttribute('data-page-agent-not-interactive', '');
      host.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:2147483647;width:max-content;max-width:calc(100vw - 16px);color-scheme:light dark;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = styles;
      const mount = document.createElement('div');
      mount.className = 'octopus-recorder';
      shadow.append(style, mount);
      document.documentElement.append(host);
      this.host = host;
      this.root = createRoot(mount);
      this.recorder = new DOMRecorder(host, this.enqueue, () => this.reportGap('frame'));
      if (document.querySelector('iframe, frame')) {
        this.reportGap('frame');
      }
    }
    if (session.status === 'recording' && !this.held && !this.error) {
      this.recorder?.start();
    } else {
      this.recorder?.stop();
    }
    this.render();
  }

  /**
   * Adds facts to a finite buffer; pressure pauses capture and reports a visible evidence gap.
   */
  private enqueue = (event: RecordingFact): void => {
    if (!this.session) {
      return;
    }
    if (
      this.events.length >= recordingLimits.pendingEvents ||
      new TextEncoder().encode(JSON.stringify([...this.events, event])).length >
        recordingLimits.batchBytes * 4
    ) {
      this.error = '待发送事件已满，录制暂停。请查看插件中的保存状态。';
      this.held = true;
      queueMicrotask(() => this.recorder?.stop());
      this.reportGap('overflow');
      this.render();
      return;
    }
    this.events.push(event);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flushAll().catch(() => this.transportFailed());
      }, 250);
    }
  };

  /**
   * Sends strictly ordered batches; identical retry numbers are acknowledged idempotently by storage.
   */
  private flushAll(): Promise<void> {
    if (this.pending) {
      return this.pending;
    }
    const generation = this.generation;
    this.pending = (async () => {
      while (this.events.length && this.session) {
        const session = this.session;
        let count = Math.min(recordingLimits.batchEvents, this.events.length);
        let payload = {
          type: 'recorder.batch',
          sessionId: session.id,
          epoch: session.epoch,
          batch: this.batch + 1,
          events: this.events.slice(0, count),
        };
        while (
          new TextEncoder().encode(JSON.stringify(payload)).length > recordingLimits.batchBytes &&
          count > 1
        ) {
          count = Math.floor(count / 2);
          payload = { ...payload, events: this.events.slice(0, count) };
        }
        let acknowledged = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (
            generation !== this.generation ||
            this.disposed ||
            this.session?.id !== session.id ||
            this.session.epoch !== payload.epoch
          ) {
            return;
          }
          try {
            const reply = await this.sendBatch(payload);
            if (generation !== this.generation) {
              return;
            }
            if (!reply?.ok) {
              if (reply && ['RECORDING_FORBIDDEN', 'FORBIDDEN_PAGE'].includes(reply.error)) {
                this.cleanup();
                return;
              }
              throw new Error(reply?.error ?? 'RECORDING_DELIVERY');
            }
            if (reply.value.batch !== payload.batch) {
              throw new Error('RECORDING_DELIVERY');
            }
            if (this.session?.id !== session.id || this.session.epoch !== payload.epoch) {
              return;
            }
            this.batch = payload.batch;
            this.events.splice(0, count);
            acknowledged = true;
            break;
          } catch {
            /* Retry the same finite batch; no page action is replayed. */
          }
        }
        if (!acknowledged && generation === this.generation) {
          throw new Error('RECORDING_DELIVERY');
        }
      }
    })().finally(() => {
      if (generation === this.generation) {
        this.pending = undefined;
      }
    });
    return this.pending;
  }

  /**
   * Bounds each transport wait independently; late replies cannot mutate a sealed producer epoch.
   */
  private async sendBatch(
    payload: object
  ): Promise<RecordingReply<{ batch: number; session: RecordingSession }>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        browser.runtime.sendMessage(payload),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('RECORDING_DELIVERY')), 2500);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Stops local capture when commits cannot be confirmed, rather than presenting false progress.
   */
  private transportFailed(): void {
    this.error = '事件保存未获确认，已暂停采集。请打开插件查看记录。';
    this.held = true;
    this.recorder?.stop();
    this.reportGap('delivery');
    this.render();
  }

  /**
   * Reports bounded diagnostics without leaking page content into logs.
   */
  private reportGap(reason: 'delivery' | 'overflow' | 'pagehide' | 'frame'): void {
    if (!this.session) {
      return;
    }
    const generation = this.generation;
    const sessionId = this.session.id;
    void browser.runtime.sendMessage({ type: 'recorder.gap', sessionId, reason }).catch(() => {
      if (this.disposed || generation !== this.generation || this.session?.id !== sessionId) {
        return;
      }
      this.error = '录制服务不可用，未确认的操作可能缺失。';
      this.render();
    });
  }

  /**
   * Commands the globally owned recording; failure text stays visible beside page controls.
   */
  private control = async (action: 'pause' | 'resume' | 'stop'): Promise<void> => {
    if (!this.session) {
      return;
    }
    const generation = this.generation;
    const sessionId = this.session.id;
    try {
      const reply: RecordingReply<RecordingSession> = await browser.runtime.sendMessage({
        type: 'recorder.control',
        sessionId,
        action,
      });
      if (this.disposed || generation !== this.generation || this.session?.id !== sessionId) {
        return;
      }
      if (!reply?.ok) {
        throw new Error(reply?.error ?? 'RECORDING_DELIVERY');
      }
      if (reply.value.id !== sessionId) {
        throw new Error('RECORDING_STALE');
      }
      this.error = '';
      if (action === 'stop') {
        this.cleanup();
      } else {
        this.configure(reply.value);
      }
    } catch (error) {
      if (this.disposed || generation !== this.generation || this.session?.id !== sessionId) {
        return;
      }
      this.error = recordingError(error instanceof Error ? error.message : 'RECORDING_DELIVERY');
      this.render();
    }
  };

  /**
   * Renders a small projection; React never owns transport, page capture or session authority.
   */
  private render(): void {
    if (this.host) {
      this.root?.render(
        <RecordingToolbar host={this.host} session={this.session} error={this.error} control={this.control} />
      );
    }
  }

  /**
   * Makes navigation flushing best-effort and never claims a destroyed document can deliver reliably.
   */
  pagehide = (): void => {
    this.held = true;
    this.recorder?.stop();
    const id = this.session?.id;
    const generation = this.generation;
    void this.flushAll()
      .then(async () => {
        if (id && generation === this.generation) {
          await browser.runtime.sendMessage({ type: 'recorder.depart', sessionId: id });
        }
      })
      .catch(() => {
        if (generation === this.generation) {
          this.reportGap('pagehide');
        }
      });
  };

  /**
   * Revalidates BFCache documents instead of reusing stale recording ownership.
   */
  pageshow = (): void => {
    this.generation++;
    this.pending = undefined;
    this.events = [];
    this.error = '';
    this.held = true;
    void this.hello();
  };

  /**
   * Releases document-owned UI, listeners and timers while leaving durable recordings intact.
   */
  private cleanup(): void {
    this.generation++;
    this.pending = undefined;
    this.recorder?.stop();
    this.recorder = undefined;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.root?.unmount();
    this.root = undefined;
    this.host?.remove();
    this.host = undefined;
    this.events = [];
    this.session = null;
  }

  /**
   * Prevents late messaging callbacks from resurrecting invalidated content resources.
   */
  dispose(): void {
    this.disposed = true;
    this.cleanup();
  }
}
