/**
 * @author Codex
 * @description Defines extension-private recording messages, bounded facts and persisted session metadata.
 */
import { z } from 'zod';
import { browserChoiceControlSchema } from '@octopus/shared/protocol/browser-skills';

export const recordingLimits = {
  batchBytes: 65536,
  batchEvents: 100,
  pendingEvents: 400,
  events: 20000,
  sessionBytes: 20 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  tabs: 32,
  retentionMs: 30 * 86400000,
};
export const factSchema = z.strictObject({
  id: z.uuid(),
  at: z.number().finite().nonnegative(),
  action: z.enum([
    'click',
    'input',
    'select',
    'key',
    'scroll',
    'submit',
    'navigate',
    'tab_open',
    'tab_activate',
    'tab_close',
    'tab_move',
    'unsupported',
  ]),
  label: z.string().max(160),
  url: z.string().max(1024),
  role: z.string().max(40).optional(),
  control: browserChoiceControlSchema.optional(),
  inputType: z.string().max(40).optional(),
  key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']).optional(),
  redacted: z.boolean().optional(),
  targetUrl: z.string().max(1024).optional(),
  targetRef: z
    .string()
    .regex(/^control-\d+$/)
    .max(80)
    .optional(),
  editRef: z.uuid().optional(),
});
export type RecordingFact = z.infer<typeof factSchema>;
export type RecordedEvent = RecordingFact & {
  sessionId: string;
  seq: number;
  tabRef: string;
  documentId: string;
  source: 'dom' | 'browser';
  causationId?: string;
};
export type RecordingPage = {
  tabId: number;
  tabRef: string;
  origin: string;
  title: string;
  documentId?: string;
  sealed?: boolean;
  lastBatch: number;
  included: boolean;
};
export type RecordingSession = {
  repairOf?: string;
  repairVersion?: 1;
  id: string;
  name: string;
  status: 'recording' | 'paused' | 'stopping' | 'stopped' | 'interrupted';
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  resumedAt: number | null;
  windowId: number;
  origins: string[];
  includeRelated: boolean;
  pages: RecordingPage[];
  epoch: number;
  count: number;
  actionCount: number;
  recentEvents: RecordedEvent[];
  bytes: number;
  gaps: string[];
};
export type RecordingSummary = Pick<
  RecordingSession,
  'id' | 'name' | 'status' | 'startedAt' | 'actionCount'
> & { gapCount: number };
export const recordingCursorSchema = z.strictObject({
  before: z.tuple([z.number().finite().nonnegative(), z.uuid()]),
  query: z.string().max(80),
});
export type RecordingCursor = z.infer<typeof recordingCursorSchema>;
export type RecordingListPage = { items: RecordingSummary[]; nextCursor: RecordingCursor | null };
export type RecordingView = {
  active: RecordingSession | null;
  recent: RecordingSummary[];
  current: { tabId: number; title: string; origin: string } | null;
};
export type RecordingHello = { session: RecordingSession | null; lastBatch: number };
export const recordingRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('recorder.status') }),
  z.strictObject({
    type: z.literal('recorder.list'),
    query: z.string().max(80).default(''),
    cursor: recordingCursorSchema.nullable().default(null),
  }),
  z.strictObject({
    type: z.literal('recorder.start'),
    tabId: z.number().int().nonnegative(),
    includeRelated: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('recorder.control'),
    sessionId: z.uuid(),
    action: z.enum(['pause', 'resume', 'stop']),
  }),
  z.strictObject({
    type: z.literal('recorder.include'),
    sessionId: z.uuid(),
    tabId: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('recorder.remove'),
    sessionId: z.uuid(),
    tabId: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('recorder.detail'),
    sessionId: z.uuid(),
    after: z.number().int().nonnegative().default(0),
  }),
  z.strictObject({
    type: z.literal('recorder.rename'),
    sessionId: z.uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.strictObject({ type: z.literal('recorder.delete'), sessionId: z.uuid() }),
  z.strictObject({ type: z.literal('recorder.hello') }),
  z.strictObject({ type: z.literal('recorder.depart'), sessionId: z.uuid() }),
  z.strictObject({
    type: z.literal('recorder.batch'),
    sessionId: z.uuid(),
    epoch: z.number().int(),
    batch: z.number().int().positive(),
    events: z.array(factSchema).max(recordingLimits.batchEvents),
  }),
  z.strictObject({
    type: z.literal('recorder.gap'),
    sessionId: z.uuid(),
    reason: z.enum(['delivery', 'overflow', 'pagehide', 'frame']),
  }),
]);
export type RecordingRequest = z.infer<typeof recordingRequestSchema>;
export type RecordingReply<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Identifies sessions that still own their recording scope.
 */
export function isActive(session: RecordingSession): boolean {
  return ['recording', 'paused', 'stopping'].includes(session.status);
}

/**
 * Computes effective recording time without counting paused intervals.
 */
export function recordingDuration(session: RecordingSession, now = Date.now()): string {
  const seconds = Math.floor(
    (session.elapsedMs + (session.resumedAt === null ? 0 : Math.max(0, now - session.resumedAt))) / 1000
  );
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * Maps finite failures to actionable UI copy without exposing browser diagnostics or URLs.
 */
export function recordingError(code: string): string {
  const messages: Record<string, string> = {
    BROWSER_BUSY: '页面正在被自动化任务使用，请结束任务后再试。',
    FORBIDDEN_PAGE: '此页面无法录制，请切换到允许访问的普通网页。',
    RECORDING_BUSY: '已有录制正在进行。',
    RECORDING_STALE: '录制状态已变化，请刷新后再试。',
    RECORDING_STORAGE: '无法保存到本地，请检查浏览器存储空间。',
    RECORDING_LIMIT: '已达到录制限额，现有记录已保留。',
    RECORDING_DELIVERY: '页面未能确认录制状态，请刷新页面后再试。',
    RECORDING_FORBIDDEN: '此页面不在录制范围内。',
  };
  return messages[code] ?? '操作未完成，请重新查看录制状态后再试。';
}
