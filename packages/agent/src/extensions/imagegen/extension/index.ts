/**
 * @author Codex
 * @description Registers the image tool for ordinary CLI and RPC sessions.
 */
import { fileURLToPath } from 'node:url';
import { readImagegenSettings } from '../lib/configuration.js';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const skillDirectory = fileURLToPath(new URL('../skills/imagegen/', import.meta.url));

/**
 * Creates a stateless extension; each execution uses only its current session context.
 */
export function createImagegenExtension(agentDir: string) {
  return (pi: ExtensionAPI): void => {
    pi.on('resources_discover', () => ({ skillPaths: [skillDirectory] }));
    pi.on('before_agent_start', async (event) => {
      if (!pi.getActiveTools().includes('image_generate')) {
        return;
      }
      let serviceContext: string;
      try {
        const settings = await readImagegenSettings(agentDir);
        const provider = settings.providers[settings.activeProvider];
        serviceContext = JSON.stringify({
          enabled: settings.enabled,
          provider: settings.activeProvider,
          model: provider.model,
        });
      } catch {
        serviceContext =
          'Image service settings are unavailable. Report configuration errors without changing providers or reading credential files.';
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n<image_service_context>${serviceContext}</image_service_context>`,
      };
    });
    pi.registerTool({
      name: 'image_generate',
      label: 'Generate image',
      description:
        'Generate an image or edit reference images using the independently configured OpenAI or Qwen image service. Use this for image generation and edits. For changes to an existing or previous image, pass its path in referenceImages; never substitute text-only generation. Read the imagegen skill before invoking this tool and follow the active image service context. Reference images must be workspace PNG/JPEG/WebP files (up to 4 for OpenAI or 3 for Qwen editing models, total 8 MiB); uploaded attachment originalPath and previous generated paths are supported. Outputs are saved to generated-images/ by default. Do not silently discard reference images or retry a failed billed request.',
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, maxLength: 32000 }),
        referenceImages: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 4 })),
        outputDirectory: Type.Optional(Type.String({ minLength: 1 })),
      }),
      /**
       * Executes with the current workspace and cancellation signal only.
       */
      async execute(_id, args, signal, _update, ctx) {
        const { generateImage } = await import('../services/imagegen-service.js');
        return generateImage({ ...args, agentDir, cwd: ctx.cwd, signal });
      },
    });
  };
}
