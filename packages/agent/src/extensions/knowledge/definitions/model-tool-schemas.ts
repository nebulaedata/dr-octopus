/**
 * @author Codex
 * @description Bounded schemas for standalone Agent inference without collection or provider configuration inputs.
 */
import { Type } from 'typebox';

export const modelToolNames = ['ocr_image', 'embed_text', 'rerank_documents'];
export const modelToolSchemas = {
  ocr: Type.Object(
    {
      path: Type.String({
        minLength: 1,
        maxLength: 2000,
        description:
          'Absolute path to a local image or a path relative to the current workspace. Files outside the workspace are supported; HTTP URLs are not accepted.',
      }),
    },
    { additionalProperties: false }
  ),
  embed: Type.Object(
    { texts: Type.Array(Type.String({ minLength: 1, maxLength: 24_000 }), { minItems: 1, maxItems: 4 }) },
    { additionalProperties: false }
  ),
  rerank: Type.Object(
    {
      query: Type.String({ minLength: 1, maxLength: 2000 }),
      documents: Type.Array(Type.String({ minLength: 1, maxLength: 48_000 }), { minItems: 1, maxItems: 40 }),
    },
    { additionalProperties: false }
  ),
};
