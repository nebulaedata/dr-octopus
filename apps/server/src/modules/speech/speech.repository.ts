/**
 * @author Codex
 * @description Owns atomic Server-local speech configuration persistence and redacted revision tokens.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { speechSettingsSchema, speechProviderConfigSchema } from '@octopus/shared/protocol';
import { z } from 'zod';

const storedProviderSchema = speechProviderConfigSchema.extend({ apiKey: z.string() }).strict();
const storedSchema = speechSettingsSchema
  .extend({
    providers: z.object({ openai: storedProviderSchema, qwen: storedProviderSchema }).strict(),
  })
  .strict();
export type StoredSpeechSettings = z.infer<typeof storedSchema>;

export class SpeechRepository {
  private readonly path: string;
  /**
   * Receives the Server state directory, never the shared Agent configuration directory.
   */
  constructor(private readonly directory: string) {
    this.path = join(directory, 'speech.json');
  }
  /**
   * Reads persisted settings without creating files for the default-disabled service.
   */
  async read() {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return {
        config: {
          enabled: false,
          activeProvider: 'openai' as const,
          providers: {
            openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', apiKey: '' },
            qwen: {
              baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
              model: 'qwen-audio-3.1-asr-flash',
              apiKey: '',
            },
          },
        },
        revision: 'missing',
      };
    }
    return {
      config: storedSchema.parse(JSON.parse(raw)),
      revision: createHash('sha256').update(raw).digest('hex'),
    };
  }
  /**
   * Atomically replaces the document; a failed write leaves the previous configuration intact.
   */
  async write(config: StoredSpeechSettings) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
