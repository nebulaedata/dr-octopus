/**
 * @author Codex
 * @description Adapts eight bounded Computer tools to guarded Windows-MCP extensions with task-bound identities and truthful action feedback.
 */
import { randomUUID } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { BasicToolError } from '../basic/basic-inputs';
import {
  actionResultSchema,
  captureSchema,
  captureFailureSchema,
  computerSchemas,
  desktopMetaSchema,
} from './computer-inputs';
import type { ComputerName, ComputerRequest, DesktopMeta } from './computer-inputs';
import type { ComputerUseActivity } from './computer-use-activity';
import type { WindowsMcpConnection } from './windows-mcp-connection';

type WindowRecord = {
  owner: string;
  taskId: string;
  epoch: string;
  session: string;
  layout: string;
  window: DesktopMeta['windows'][number];
};
type Observation = {
  owner: string;
  taskId: string;
  windowId: string;
  created: number;
  capture: ReturnType<typeof captureSchema.parse>;
};

/**
 * Validates the complete bounded PNG stream; the product backend emits non-interlaced 8-bit RGB or RGBA only.
 */
function validateImage(capture: ReturnType<typeof captureSchema.parse>): void {
  const encoded = capture.image.data;
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.toString('base64') !== encoded ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  ) {
    throw new Error('Invalid PNG');
  }
  let offset = 8;
  let channels = 0;
  let ended = false;
  let startedData = false;
  let endedData = false;
  const chunks: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (offset + 12 + size > bytes.length) {
      throw new Error('Truncated PNG');
    }
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) {
      throw new Error('PNG checksum mismatch');
    }
    if (kind === 'IHDR' && offset === 8 && size === 13) {
      const { width, height } = capture.imageSizePx;
      if (
        data.readUInt32BE(0) !== width ||
        data.readUInt32BE(4) !== height ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9]) ||
        data[10] ||
        data[11] ||
        data[12]
      ) {
        throw new Error('Unsupported PNG layout');
      }
      channels = data[9] === 6 ? 4 : 3;
    } else if (kind === 'IDAT' && channels && !endedData) {
      startedData = true;
      chunks.push(data);
    } else if (kind === 'IEND' && size === 0 && startedData) {
      ended = true;
      offset += 12;
      break;
    } else {
      if (!channels || kind === 'IHDR' || kind === 'IDAT' || /^[A-Z]/.test(kind)) {
        throw new Error('Unsupported PNG chunk');
      }
      endedData ||= startedData;
    }
    offset += size + 12;
  }
  if (!ended || offset !== bytes.length) {
    throw new Error('Incomplete PNG');
  }
  const stride = capture.imageSizePx.width * channels + 1;
  const length = stride * capture.imageSizePx.height;
  const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: length });
  if (pixels.length !== length) {
    throw new Error('Invalid PNG pixels');
  }
  for (let row = 0; row < pixels.length; row += stride) {
    if (pixels[row] > 4) {
      throw new Error('Invalid PNG filter');
    }
  }
}

export class ComputerTools {
  private readonly windows = new Map<string, WindowRecord>();
  private readonly observations = new Map<string, Observation>();
  private busy = false;
  private uncertain: ReturnType<ComputerUseActivity['begin']> | undefined;
  private closed = false;
  private settled: Promise<void> = Promise.resolve();

  /**
   * Owns one local backend epoch; unavailable resources leave all desktop tools unavailable.
   */
  constructor(
    private readonly activity: ComputerUseActivity,
    private connection?: WindowsMcpConnection
  ) {}

  /**
   * Attaches exactly one negotiated owner connection; only trusted Runtime assembly calls this method.
   * @throws If the owner is closed, already attached or lacks the exact guarded product contract.
   */
  attach(connection: WindowsMcpConnection): void {
    if (this.closed || this.connection || !connection.supportsProductContract()) {
      throw new Error('COMPUTER_CONNECTION_REJECTED');
    }
    this.connection = connection;
  }

  /**
   * Connection discovery alone is insufficient; only a loopback or owned stdio backend with every exact product schema qualifies.
   */
  available(): boolean {
    return !this.closed && !this.uncertain && (this.connection?.supportsProductContract() ?? false);
  }

  /**
   * Opens continuous feedback only after the trusted task authority admits Computer capabilities.
   */
  startTask(taskId: string): void {
    this.activity.startTask(taskId);
  }

  /**
   * Invalidates executable observations at task/Basic transitions without reusing window identifiers across tasks.
   */
  invalidate(taskId: string): void {
    for (const [id, observation] of this.observations) {
      if (observation.taskId === taskId) {
        this.observations.delete(id);
      }
    }
  }

  /**
   * Retires task identities after admission stops; no foreign owner can inherit its observations.
   */
  release(taskId: string): void {
    this.activity.endTask(taskId);
    this.clearTargets(taskId);
  }

  /**
   * Refreshes executable targets without ending the surrounding Computer session.
   */
  private clearTargets(taskId: string): void {
    this.invalidate(taskId);
    for (const [id, window] of this.windows) {
      if (window.taskId === taskId) {
        this.windows.delete(id);
      }
    }
  }

  /**
   * Validates a named call, serializes the backend and binds every identity to the authenticated owner and active task.
   * @throws Stable public errors without revealing raw handles, backend responses or credentials.
   */
  async call(owner: string, taskId: string, name: ComputerName, input: unknown): Promise<unknown> {
    const request = computerSchemas[name].parse(input) as ComputerRequest;
    if (request.taskId !== taskId) {
      throw new BasicToolError('TASK_NOT_FOUND', 'The Computer call is not bound to this task.');
    }
    if (!this.available()) {
      throw new BasicToolError('COMPUTER_UNAVAILABLE', 'The guarded local Computer backend is unavailable.');
    }
    if (this.busy) {
      throw new BasicToolError('ACTION_IN_PROGRESS', 'A Computer call is already in progress.');
    }
    this.busy = true;
    let settle!: () => void;
    this.settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      const connection = this.connection!;
      const epoch = connection.readStatus().backendEpoch;
      const meta = desktopMetaSchema.parse(
        await connection.callProduct('ExecutorDesktopMeta', { contractVersion: 1 })
      );
      if (
        !meta.interactive ||
        new Set(meta.displays.map((display) => display.index)).size !== meta.displays.length
      ) {
        throw new BasicToolError(
          'SESSION_UNAVAILABLE',
          'The interactive desktop or display layout is unavailable.'
        );
      }
      if (name === 'computer_displays') {
        return { layoutVersion: meta.layoutVersion, displays: meta.displays };
      }
      if (name === 'computer_windows') {
        this.clearTargets(taskId);
        const windows = meta.windows.map((window) => {
          const windowId = randomUUID();
          this.windows.set(windowId, {
            owner,
            taskId,
            epoch,
            session: meta.desktopSessionId,
            layout: meta.layoutVersion,
            window,
          });
          return {
            windowId,
            title: window.title,
            bounds: window.bounds,
            foreground: JSON.stringify(window.identity) === JSON.stringify(meta.foreground),
          };
        });
        return { windows };
      }
      const requestedId = 'windowId' in request ? request.windowId : undefined;
      let windowId = requestedId;
      let record = windowId ? this.windows.get(windowId) : undefined;
      if (name === 'computer_observe' && !windowId) {
        const window = meta.windows.find(
          (item) => JSON.stringify(item.identity) === JSON.stringify(meta.foreground)
        );
        if (window) {
          this.clearTargets(taskId);
          windowId = randomUUID();
          record = {
            owner,
            taskId,
            epoch,
            session: meta.desktopSessionId,
            layout: meta.layoutVersion,
            window,
          };
          this.windows.set(windowId, record);
        }
      }
      const current = meta.windows.find(
        (item) => JSON.stringify(item.identity) === JSON.stringify(record?.window.identity)
      );
      if (
        !windowId ||
        !record ||
        record.owner !== owner ||
        record.taskId !== taskId ||
        record.epoch !== epoch ||
        record.session !== meta.desktopSessionId ||
        record.layout !== meta.layoutVersion ||
        !current ||
        JSON.stringify(current.bounds) !== JSON.stringify(record.window.bounds)
      ) {
        this.invalidate(taskId);
        throw new BasicToolError('TARGET_CHANGED', 'Obtain a fresh window identity for the current desktop.');
      }
      const target = {
        contractVersion: 1 as const,
        desktopSessionId: meta.desktopSessionId,
        layoutVersion: meta.layoutVersion,
        identity: current.identity,
        expectedBoundsPx: current.bounds,
      };
      if (name === 'computer_observe') {
        this.invalidate(taskId);
        const rawCapture = await connection.callProduct('ExecutorCapture', target);
        const refusal = captureFailureSchema.safeParse(rawCapture);
        if (refusal.success) {
          const messages = {
            TARGET_CHANGED:
              'The target changed or lost foreground during capture; obtain a fresh observation.',
            SESSION_UNAVAILABLE: 'The interactive desktop is unavailable; no observation was created.',
            CAPTURE_UNVERIFIED: 'The captured region could not be verified; no observation was created.',
            CAPTURE_LIMIT: 'The captured image exceeds the output limit; no observation was created.',
            CAPTURE_FAILED: 'The local screenshot backend failed; no observation was created.',
          };
          const code = refusal.data.error.code;
          throw new BasicToolError(code, messages[code]);
        }
        const parsedCapture = captureSchema.safeParse(rawCapture);
        if (!parsedCapture.success) {
          throw new BasicToolError(
            'CAPTURE_RESPONSE_INVALID',
            'The capture response does not match the product contract.'
          );
        }
        const capture = parsedCapture.data;
        if (
          JSON.stringify(capture.identity) !== JSON.stringify(current.identity) ||
          capture.desktopSessionId !== meta.desktopSessionId ||
          capture.layoutVersion !== meta.layoutVersion ||
          JSON.stringify(capture.captureRectPx) !== JSON.stringify(current.bounds) ||
          JSON.stringify(capture.expectedBoundsPx) !== JSON.stringify(current.bounds)
        ) {
          throw new BasicToolError(
            'CAPTURE_UNVERIFIED',
            'The captured region does not match the validated target.'
          );
        }
        try {
          validateImage(capture);
        } catch {
          throw new BasicToolError('CAPTURE_IMAGE_INVALID', 'The captured PNG could not be validated.');
        }
        const observationId = randomUUID();
        this.observations.set(observationId, {
          owner,
          taskId,
          windowId,
          created: performance.now(),
          capture,
        });
        return {
          observationId,
          windowId,
          captureRectPx: capture.captureRectPx,
          imageSizePx: capture.imageSizePx,
          image: capture.image,
        };
      }
      let backendAction: unknown;
      if (name !== 'computer_focus') {
        const observation =
          'observationId' in request ? this.observations.get(request.observationId) : undefined;
        if (
          !observation ||
          observation.owner !== owner ||
          observation.taskId !== taskId ||
          observation.windowId !== windowId ||
          performance.now() - observation.created > 10000 ||
          JSON.stringify(meta.foreground) !== JSON.stringify(current.identity)
        ) {
          this.invalidate(taskId);
          throw new BasicToolError(
            'OBSERVATION_STALE',
            'Observe the current foreground target before each input action.'
          );
        }
        if ('point' in request) {
          const { imageSizePx: size, captureRectPx: bounds } = observation.capture;
          if (request.point.x >= size.width || request.point.y >= size.height) {
            throw new BasicToolError('INVALID_POINT', 'The point is outside the observation image.');
          }
          const x = bounds.left + Math.floor(((request.point.x + 0.5) * bounds.width) / size.width);
          const y = bounds.top + Math.floor(((request.point.y + 0.5) * bounds.height) / size.height);
          backendAction =
            name === 'computer_click' && 'button' in request
              ? { kind: 'click', x, y, button: request.button, clicks: request.clicks }
              : 'direction' in request
                ? { kind: 'scroll', x, y, direction: request.direction, count: request.count }
                : undefined;
        } else if ('text' in request) {
          backendAction = { kind: 'type', text: request.text, clear: request.clear };
        } else if ('key' in request) {
          backendAction = { kind: 'key', key: request.key, modifiers: request.modifiers };
        }
      }
      this.invalidate(taskId);
      const feedback = this.activity.begin();
      let dispatched = false;
      try {
        await feedback.ready();
        if (this.closed || !connection.supportsProductContract()) {
          throw new Error('Computer backend closed before dispatch');
        }
        dispatched = true;
        const raw =
          name === 'computer_focus'
            ? await connection.callProduct('ExecutorFocusWindow', target)
            : await connection.callProduct('ExecutorInput', { ...target, action: backendAction });
        const result = actionResultSchema.parse(raw);
        if (result.effect === 'unknown') {
          this.uncertain = feedback;
          feedback.uncertain();
        } else {
          feedback.complete();
        }
        return { businessEffect: result.effect, code: result.code };
      } catch {
        if (!dispatched) {
          feedback.complete();
          if (this.closed) {
            throw new BasicToolError(
              'COMPUTER_UNAVAILABLE',
              'Local desktop control was stopped; no input was dispatched.'
            );
          }
          throw new BasicToolError(
            'COMPUTER_INDICATOR_UNAVAILABLE',
            'Visible Computer feedback could not be confirmed; no input action was dispatched.'
          );
        }
        this.uncertain = feedback;
        feedback.uncertain();
        throw new BasicToolError(
          'COMPUTER_RESULT_UNKNOWN',
          'The action outcome is unknown; it must not be replayed.'
        );
      }
    } catch (error) {
      if (error instanceof BasicToolError) {
        throw error;
      }
      throw new BasicToolError(
        'COMPUTER_RESPONSE_INVALID',
        'The guarded Computer response could not be validated.'
      );
    } finally {
      this.busy = false;
      settle();
    }
  }

  /**
   * Closes the owned backend; uncertain feedback clears only after confirmed local process-tree cleanup.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.windows.clear();
    this.observations.clear();
    const stopped = await this.connection?.close();
    await this.settled;
    if (stopped?.executionStopConfirmed) {
      this.activity.endTasks();
      this.uncertain?.complete();
      this.uncertain = undefined;
    }
  }
}
