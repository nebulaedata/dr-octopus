/**
 * @author Codex
 * @description Owns finite Computer result envelopes and upstream content validation shared by execution and MCP serialization.
 */
import { z } from 'zod';
import { windowsMcpStatusSchema } from '../../contracts/windows-mcp';
import { controlStatusSchema } from './computer-inputs';

const contentSchema = z
  .array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string().max(256 * 1024) }),
      z.object({
        type: z.literal('image'),
        mimeType: z.enum(['image/png', 'image/jpeg']),
        data: z
          .string()
          .min(1)
          .max(8 * 1024 * 1024),
      }),
    ])
  )
  .max(16);
const completedSchema = z.strictObject({
  computerContent: contentSchema,
  backend: windowsMcpStatusSchema,
  businessEffect: z.enum(['applied', 'not_applied']),
  resultMeaning: z.string(),
  code: z.literal('OK'),
});
const computerResultSchema = z.union([
  z.strictObject({ control: controlStatusSchema, backend: windowsMcpStatusSchema }),
  completedSchema,
]);
export type ComputerResult = z.infer<typeof computerResultSchema>;
export const computerCallResultSchema = z.union([
  computerResultSchema,
  z.strictObject({
    retained: z.literal(true),
    businessEffect: z.string().optional(),
    code: z.string().optional(),
  }),
]);
/**
 * Bounds and validates image encodings without manufacturing upstream pixels or duplicating them in metadata.
 */
export function validateComputerContent(input: unknown): z.infer<typeof contentSchema> {
  const blocks = contentSchema.parse(input);
  if (blocks.filter((block) => block.type === 'image').length > 4) {
    throw new Error('Image count limit');
  }
  for (const block of blocks) {
    if (block.type !== 'image') {
      continue;
    }
    const bytes = Buffer.from(block.data, 'base64');
    if (bytes.toString('base64') !== block.data || bytes.length > 6 * 1024 * 1024) {
      throw new Error('Invalid image encoding');
    }
    if (
      block.mimeType === 'image/png'
        ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        : bytes.subarray(0, 3).toString('hex') !== 'ffd8ff'
    ) {
      throw new Error('Invalid image signature');
    }
  }
  return blocks;
}
