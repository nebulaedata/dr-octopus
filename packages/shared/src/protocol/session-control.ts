/**
 * @author Codex
 * @description Defines validated Session restart requests and non-persistent control projections.
 */
import { z } from 'zod';

export const RestartSessionBodySchema = z
  .object({
    expectedRuntime: z
      .object({ runtimeId: z.string().min(1), epoch: z.number().int().positive() })
      .strict()
      .nullable(),
    allowInterrupt: z.boolean().default(false),
    whenIdle: z.boolean().optional(),
  })
  .strict();

export type RestartSessionBody = z.infer<typeof RestartSessionBodySchema>;

export interface SessionRuntimeControlDto {
  restartRequired: boolean;
  restartOnIdle?: boolean;
  changedConfigRoutes: string[];
  restart: {
    status: 'idle' | 'restarting' | 'failed';
    error?: { code: string; message: string; retryable: boolean };
  };
}
