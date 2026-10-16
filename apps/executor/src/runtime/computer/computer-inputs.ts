/**
 * @author Codex
 * @description Defines finite public Computer calls and the versioned product backend contract without raw tool forwarding.
 */
import { z } from 'zod';

const rect = z.strictObject({
  left: z.number().int().min(-100000).max(100000),
  top: z.number().int().min(-100000).max(100000),
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
});
const identity = z.strictObject({
  hwnd: z.string().regex(/^[1-9][0-9]{0,19}$/),
  pid: z.number().int().positive(),
  processStartedAt: z.string().regex(/^[0-9]{1,20}$/),
});
export const desktopMetaSchema = z.strictObject({
  contractVersion: z.literal(1),
  desktopSessionId: z.string().min(1).max(128),
  layoutVersion: z.string().min(1).max(128),
  interactive: z.boolean(),
  foreground: identity.nullable(),
  displays: z
    .array(z.strictObject({ index: z.number().int().nonnegative(), bounds: rect }))
    .min(1)
    .max(16),
  windows: z
    .array(
      z.strictObject({
        identity,
        title: z.string().max(512),
        bounds: rect,
      })
    )
    .max(256),
});
export type DesktopMeta = z.infer<typeof desktopMetaSchema>;
const base = { taskId: z.uuid() };
const target = { windowId: z.uuid(), observationId: z.uuid() };
const point = z.strictObject({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  coordinateSpace: z.literal('observation_image_px'),
});
const action = { ...base, ...target, idempotencyKey: z.string().min(1).max(128) };
export const computerSchemas = {
  computer_displays: z.strictObject(base),
  computer_windows: z.strictObject(base),
  computer_observe: z.strictObject({ ...base, windowId: z.uuid().optional() }),
  computer_focus: z.strictObject({ ...base, windowId: z.uuid(), idempotencyKey: action.idempotencyKey }),
  computer_click: z.strictObject({
    ...action,
    point,
    button: z.enum(['left', 'right', 'middle']).default('left'),
    clicks: z.number().int().min(1).max(2).default(1),
  }),
  computer_type: z.strictObject({
    ...action,
    text: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          value.isWellFormed() &&
          [...value].length <= 256 &&
          Buffer.byteLength(value) <= 2048 &&
          [...value].every((character) => {
            const code = character.codePointAt(0)!;
            return code >= 32 && (code < 127 || code > 159);
          })
      ),
    clear: z.boolean().default(false),
  }),
  computer_key: z.strictObject({
    ...action,
    key: z.enum([
      'Enter',
      'Tab',
      'Escape',
      'Backspace',
      'Delete',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'Space',
      'a',
      'c',
      'v',
      'x',
      'z',
      'y',
    ]),
    modifiers: z
      .array(z.enum(['Control', 'Alt', 'Shift', 'Meta']))
      .max(4)
      .refine((values) => new Set(values).size === values.length)
      .default([]),
  }),
  computer_scroll: z.strictObject({
    ...action,
    point,
    direction: z.enum(['up', 'down']),
    count: z.number().int().min(1).max(10),
  }),
} as const;
export type ComputerName = keyof typeof computerSchemas;
export type ComputerRequest = {
  [Name in ComputerName]: z.infer<(typeof computerSchemas)[Name]>;
}[ComputerName];
const backendTarget = {
  desktopSessionId: desktopMetaSchema.shape.desktopSessionId,
  layoutVersion: desktopMetaSchema.shape.layoutVersion,
  identity,
  expectedBoundsPx: rect,
};
export const backendSchemas = {
  ExecutorDesktopMeta: z.strictObject({ contractVersion: z.literal(1) }),
  ExecutorCapture: z.strictObject({ contractVersion: z.literal(1), ...backendTarget }),
  ExecutorFocusWindow: z.strictObject({ contractVersion: z.literal(1), ...backendTarget }),
  ExecutorInput: z.strictObject({
    contractVersion: z.literal(1),
    ...backendTarget,
    action: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('click'),
        x: rect.shape.left,
        y: rect.shape.top,
        button: computerSchemas.computer_click.shape.button,
        clicks: computerSchemas.computer_click.shape.clicks,
      }),
      z.strictObject({
        kind: z.literal('type'),
        text: computerSchemas.computer_type.shape.text,
        clear: computerSchemas.computer_type.shape.clear,
      }),
      z.strictObject({
        kind: z.literal('key'),
        key: computerSchemas.computer_key.shape.key,
        modifiers: computerSchemas.computer_key.shape.modifiers,
      }),
      z.strictObject({
        kind: z.literal('scroll'),
        x: rect.shape.left,
        y: rect.shape.top,
        direction: computerSchemas.computer_scroll.shape.direction,
        count: computerSchemas.computer_scroll.shape.count,
      }),
    ]),
  }),
} as const;
export type BackendName = keyof typeof backendSchemas;
export const captureSchema = z.strictObject({
  contractVersion: z.literal(1),
  ...backendTarget,
  captureRectPx: rect,
  imageSizePx: z.strictObject({
    width: z.number().int().min(1).max(1920),
    height: z.number().int().min(1).max(1920),
  }),
  image: z.strictObject({ mimeType: z.literal('image/png'), data: z.string().min(1).max(2796204) }),
});
export const captureFailureSchema = z.strictObject({
  contractVersion: z.literal(1),
  error: z.strictObject({
    code: z.enum([
      'TARGET_CHANGED',
      'SESSION_UNAVAILABLE',
      'CAPTURE_UNVERIFIED',
      'CAPTURE_LIMIT',
      'CAPTURE_FAILED',
    ]),
  }),
});
export const actionResultSchema = z.strictObject({
  contractVersion: z.literal(1),
  effect: z.enum(['applied', 'not_applied', 'unknown']),
  code: z.enum([
    'OK',
    'TARGET_CHANGED',
    'FOCUS_DENIED',
    'SESSION_UNAVAILABLE',
    'PARTIAL_INPUT',
    'INPUT_FAILED',
    'INPUT_BUSY',
  ]),
});
