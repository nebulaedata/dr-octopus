/**
 * @author Codex
 * @description Defines finite Browser tool inputs and document-bound page messages without platform dependencies.
 */
import { z } from 'zod';
const tab = z.number().int().min(0);
const url = z
  .string()
  .max(8192)
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
export const pageIdentitySchema = z.strictObject({
  documentId: z.string().min(1).max(128),
  controllerId: z.uuid(),
});
export const snapshotTargetSchema = pageIdentitySchema.extend({
  snapshotId: z.uuid(),
  elementIndex: z.number().int().min(0).max(1000000).optional(),
});
/**
 * This allowlist intentionally excludes arbitrary scripts. The browser extension uses pnpm patch
 * (patches/@page-agent__page-controller@1.12.4.patch) to remove the unused executeJavascript implementation.
 */
export const browserParams = {
  browser_tabs: z.strictObject({}),
  browser_open_tab: z.strictObject({ url, background: z.boolean().default(true) }),
  browser_navigate: z.strictObject({ tabId: tab, url }),
  browser_close_tab: z.strictObject({ tabId: tab }),
  browser_snapshot: z.strictObject({ tabId: tab, screenshot: z.boolean().default(true) }),
  browser_read_snapshot: z.strictObject({
    tabId: tab,
    ...pageIdentitySchema.shape,
    snapshotId: z.uuid(),
    page: z.number().int().min(0).max(128),
  }),
  browser_click: z.strictObject({
    tabId: tab,
    target: snapshotTargetSchema.extend({ elementIndex: z.number().int().min(0).max(1000000) }),
  }),
  browser_fill: z.strictObject({
    tabId: tab,
    target: snapshotTargetSchema.extend({ elementIndex: z.number().int().min(0).max(1000000) }),
    text: z.string().max(32000),
  }),
  browser_select: z.strictObject({
    tabId: tab,
    target: snapshotTargetSchema.extend({ elementIndex: z.number().int().min(0).max(1000000) }),
    optionText: z.string().max(4096),
  }),
  browser_scroll: z.strictObject({
    tabId: tab,
    target: snapshotTargetSchema,
    direction: z.enum(['up', 'down', 'left', 'right']),
    pixels: z.number().int().min(1).max(10000),
  }),
} as const;
export type BrowserMethod = keyof typeof browserParams;
const common = {
  type: z.literal('request'),
  requestId: z.uuid(),
  connectionId: z.uuid(),
  taskId: z.uuid().optional(),
};
export const browserRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ ...common, method: z.literal('browser_tabs'), params: browserParams.browser_tabs }),
  z.strictObject({
    ...common,
    method: z.literal('browser_open_tab'),
    params: browserParams.browser_open_tab,
  }),
  z.strictObject({
    ...common,
    method: z.literal('browser_navigate'),
    params: browserParams.browser_navigate,
  }),
  z.strictObject({
    ...common,
    method: z.literal('browser_close_tab'),
    params: browserParams.browser_close_tab,
  }),
  z.strictObject({
    ...common,
    method: z.literal('browser_snapshot'),
    params: browserParams.browser_snapshot,
  }),
  z.strictObject({
    ...common,
    method: z.literal('browser_read_snapshot'),
    params: browserParams.browser_read_snapshot,
  }),
  z.strictObject({ ...common, method: z.literal('browser_click'), params: browserParams.browser_click }),
  z.strictObject({ ...common, method: z.literal('browser_fill'), params: browserParams.browser_fill }),
  z.strictObject({ ...common, method: z.literal('browser_select'), params: browserParams.browser_select }),
  z.strictObject({ ...common, method: z.literal('browser_scroll'), params: browserParams.browser_scroll }),
]);
export const browserReleaseSchema = z.strictObject({
  type: z.literal('release'),
  requestId: z.uuid(),
  connectionId: z.uuid(),
  taskId: z.uuid(),
});
export const browserCommandSchema = z.union([browserRequestSchema, browserReleaseSchema]);
export const browserErrorSchema = z.enum([
  'BROWSER_OFFLINE',
  'BROWSER_BUSY',
  'FORBIDDEN_PAGE',
  'TAB_NOT_EXECUTABLE',
  'TARGET_CHANGED',
  'STALE_SNAPSHOT',
  'SNAPSHOT_EXPIRED',
  'SNAPSHOT_LIMIT',
  'ACTION_FAILED',
  'OUTCOME_UNKNOWN',
  'INVALID_MESSAGE',
  'PAYLOAD_TOO_LARGE',
]);
export const browserResultSchema = z
  .strictObject({
    type: z.literal('result'),
    requestId: z.uuid(),
    connectionId: z.uuid(),
    result: z.unknown().optional(),
    error: browserErrorSchema.optional(),
  })
  .refine((value) => (value.error !== undefined) !== Object.hasOwn(value, 'result'));
export const browserSnapshotImageSchema = z.strictObject({
  mimeType: z.literal('image/jpeg'),
  data: z
    .string()
    .min(4)
    .max(174764)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().min(1).max(1280),
  height: z.number().int().min(1).max(1280),
});
export const snapshotPageSchema = pageIdentitySchema.extend({
  snapshotId: z.uuid(),
  page: z.number().int().min(0),
  pages: z.number().int().min(1).max(128),
  totalBytes: z.number().int().min(0).max(2097152),
  text: z.string().max(65536),
  title: z.string().max(4096),
  url,
  expiresAt: z.number().int(),
  image: browserSnapshotImageSchema.optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const browserActionSchema = z.strictObject({
  businessEffect: z.enum(['applied', 'not_applied', 'unknown']),
  code: z.string().max(100),
});
export const browserTabSchema = z.strictObject({ tabId: tab, title: z.string().max(4096), url });
export type BrowserRequest = z.infer<typeof browserRequestSchema>;
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
