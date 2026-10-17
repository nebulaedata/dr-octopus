/**
 * @author Codex
 * @description Defines one finite desktop-control API and its upstream mapping, independent of legacy window observations.
 */
import { z } from 'zod';
import { BasicToolError } from '../basic/basic-inputs';
const base = { taskId: z.uuid() };
const operation = { ...base, idempotencyKey: z.string().min(1).max(128) };
const coordinate = z.number().int().min(-100000).max(100000);
const point = z.tuple([coordinate, coordinate]);
const region = z
  .tuple([coordinate, coordinate, coordinate, coordinate])
  .refine(
    ([left, top, right, bottom]) => right > left && bottom > top,
    'Capture region must have positive area'
  );
const capture = {
  ...operation,
  display: z.array(z.number().int().min(0).max(15)).min(1).max(16).optional(),
  region: region.optional(),
};
export const computerSchemas = {
  'computer.screenshot': z.strictObject(capture),
  'computer.snapshot': z.strictObject({ ...capture, image: z.boolean().default(true) }),
  'computer.click': z.strictObject({
    ...operation,
    point,
    button: z.enum(['left', 'right', 'middle']).default('left'),
    clicks: z.number().int().min(1).max(2).default(1),
  }),
  'computer.type': z.strictObject({
    ...operation,
    point,
    text: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => value.isWellFormed()),
    clear: z.boolean().default(false),
    pressEnter: z.boolean().default(false),
  }),
  'computer.scroll': z.strictObject({
    ...operation,
    point,
    direction: z.enum(['up', 'down', 'left', 'right']),
    count: z.number().int().min(1).max(10).default(1),
  }),
  'computer.shortcut': z.strictObject({
    ...operation,
    shortcut: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9+ _-]+$/),
  }),
  'computer.app.switch': z.strictObject({ ...operation, name: z.string().min(1).max(256) }),
  'computer.display.list': z.strictObject(operation),
  'computer.control.status': z.strictObject(base),
} as const;
export type ComputerName = keyof typeof computerSchemas;
export const computerNames = Object.keys(computerSchemas) as ComputerName[];
// Reserve for process-tree shutdown and durable result recording, outside execution time.
export const computerCleanupReserveMs = 10000;
// Both Snapshot and cold App.switch enter the same upstream get_state/UIA path.
const uiaExecutionBudget = { timeoutMs: 60000, minimumMs: 30000 } as const;
export const computerDefinitions = {
  'computer.screenshot': {
    upstream: 'Screenshot',
    description:
      '截图 / screenshot of the desktop, selected displays or physical-pixel region. Requires desktop control; upstream may acquire input ownership. Image can be scaled: use returned original/image dimensions and virtual origin for physical coordinates. Visible control ribbons may appear.',
    mutation: false,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.snapshot': {
    upstream: 'Snapshot',
    description:
      'Inspect Windows UIA and optionally a screenshot. Requires desktop control. DOM extraction and persistent element targeting are not exposed; use physical coordinates and observe again after actions.',
    mutation: false,
    ...uiaExecutionBudget,
  },
  'computer.click': {
    upstream: 'Click',
    description:
      'Click at physical virtual-desktop coordinates [x,y], including negative display origins. Re-observe before acting; this is not window isolation.',
    mutation: true,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.type': {
    upstream: 'Type',
    description:
      'Click the specified physical coordinates and type using upstream text input, which may use clipboard. clear and pressEnter are explicit. Does not promise exact inserted character counts.',
    mutation: true,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.scroll': {
    upstream: 'Scroll',
    description:
      'Scroll at physical virtual-desktop coordinates, horizontally or vertically, for a bounded wheel count.',
    mutation: true,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.shortcut': {
    upstream: 'Shortcut',
    description:
      'Send an upstream key combination such as ctrl+a to the current foreground application. Never automatically replay an uncertain shortcut.',
    mutation: true,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.app.switch': {
    upstream: 'App',
    description:
      'Switch to an existing application by name using upstream matching. Does not launch a program and does not promise exact window identity.',
    mutation: true,
    ...uiaExecutionBudget,
  },
  'computer.display.list': {
    upstream: 'DisplayInventory',
    description:
      'Read upstream display inventory. Like screenshots this requires desktop control because upstream acquires control ownership.',
    mutation: false,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
  'computer.control.status': {
    upstream: 'ControlStatus',
    description:
      'Read upstream control owner and idle wait without taking control. Requires the desktop-control grant and an active task.',
    mutation: false,
    timeoutMs: 10000,
    minimumMs: 1000,
  },
} as const satisfies Record<
  ComputerName,
  { upstream: string; description: string; mutation: boolean; timeoutMs: number; minimumMs: number }
>;
export type UpstreamName = (typeof computerDefinitions)[ComputerName]['upstream'];
export const controlStatusSchema = z.object({
  state: z.enum(['ready', 'ai', 'user', 'takeover_pending', 'unavailable']),
  generation: z.number().int().nonnegative(),
  wait_seconds: z.number().nonnegative(),
});
export type ControlStatus = z.infer<typeof controlStatusSchema>;
/**
 * Maps validated product inputs to one fixed upstream method; no method or raw arguments are accepted from clients.
 */
export function upstreamArguments(name: ComputerName, input: unknown): Record<string, unknown> {
  switch (name) {
    case 'computer.screenshot': {
      const { display, region } = computerSchemas[name].parse(input);
      return { display, region, use_annotation: false };
    }
    case 'computer.snapshot': {
      const { display, region, image } = computerSchemas[name].parse(input);
      return { display, region, use_vision: image, use_dom: false, use_annotation: false, use_ui_tree: true };
    }
    case 'computer.click': {
      const { point, button, clicks } = computerSchemas[name].parse(input);
      return { loc: point, button, clicks };
    }
    case 'computer.type': {
      const { point, text, clear, pressEnter } = computerSchemas[name].parse(input);
      return { loc: point, text, clear, press_enter: pressEnter, caret_position: 'idle' };
    }
    case 'computer.scroll': {
      const { point, direction, count } = computerSchemas[name].parse(input);
      return {
        loc: point,
        direction,
        type: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical',
        wheel_times: count,
      };
    }
    case 'computer.shortcut': {
      const { shortcut } = computerSchemas[name].parse(input);
      return { shortcut };
    }
    case 'computer.app.switch': {
      const { name: application } = computerSchemas[name].parse(input);
      return { mode: 'switch', name: application };
    }
    case 'computer.display.list':
    case 'computer.control.status':
      computerSchemas[name].parse(input);
      return {};
  }
}

/**
 * Bounds a tool and its control-status preflight by the caller/task deadline, leaving a separate cleanup reserve.
 * Rejects insufficient time before any upstream control acquisition; does not extend deadlines on progress notifications.
 */
export function computerExecutionDeadline(
  name: ComputerName,
  callerDeadlineMs: number,
  now = Date.now()
): number {
  const policy = computerDefinitions[name];
  const remaining = callerDeadlineMs - now - computerCleanupReserveMs;
  if (!Number.isFinite(remaining) || remaining < policy.minimumMs) {
    throw new BasicToolError(
      'COMPUTER_BUDGET_INSUFFICIENT',
      'The remaining client/task budget cannot accommodate this desktop tool and cleanup.'
    );
  }
  return now + Math.min(policy.timeoutMs, remaining);
}
