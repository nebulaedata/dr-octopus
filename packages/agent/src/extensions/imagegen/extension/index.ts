/**
 * @author Codex
 * @description Registers the image tool for ordinary CLI and RPC sessions.
 */
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Creates a stateless extension; each execution uses only its current session context.
 */
export function createImagegenExtension(agentDir: string) {
  return (pi: ExtensionAPI): void => {
    pi.registerTool({
      name: 'image_generate',
      label: 'Generate image',
      description:
        'Generate an image or edit reference images using the configured image model. Use this for user image-generation requests. Reference images must be workspace PNG/JPEG/WebP files (up to 4, total 8 MiB); uploaded attachment originalPath and previous generated paths are supported. Outputs are saved to generated-images/ by default. Do not silently discard reference images or retry a failed billed request.',
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, maxLength: 32000 }),
        referenceImages: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 4 })),
        outputDirectory: Type.Optional(Type.String({ minLength: 1 })),
      }),
      /**
       * Executes with the current session registry and cancellation signal only.
       */
      async execute(_id, args, signal, _update, ctx) {
        const { generateImage } = await import('../services/imagegen-service.js');
        return generateImage({ ...args, agentDir, cwd: ctx.cwd, registry: ctx.modelRegistry, signal });
      },
    });
  };
}
