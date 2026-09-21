/**
 * @author Codex
 * @description Own the sole Memory connection and validate complete operations at the daemon boundary.
 */
import { createHash } from 'node:crypto';
import {
  memoryServiceCommandSchema,
  memoryCurationBeginSchema,
  memoryCurationNextSchema,
  memoryCurationIdSchema,
  memoryRefsSchema,
} from '@octopus/shared/protocol/memory';
import { createMemoryRepository } from '../lib/repository.js';
import { memoryService } from '../services/memory-service.js';
import { MemoryError } from '../definitions/error.js';
import { createCurationSessions } from './curation.js';

/**
 * Migrate before publishing readiness; no caller receives a SQLite or transaction handle.
 */
export async function createMemoryApplication(directory: string, migrationsFolder?: string) {
  const repository = createMemoryRepository(directory, migrationsFolder);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const service = memoryService(repository, hash);
  const curation = createCurationSessions(repository, hash);
  try {
    await service.initialize();
  } catch (error) {
    await repository.dispose();
    throw error;
  }
  return {
    /**
     * Dispatch only known domain commands; model evaluation never runs inside the daemon.
     */
    async call(raw: unknown, signal: AbortSignal): Promise<unknown> {
      const parsed = memoryServiceCommandSchema.safeParse(raw);
      if (!parsed.success) {
        throw new MemoryError('INVALID_INPUT', '记忆服务请求无效。');
      }
      const { operation, input, maxBytes, epoch } = parsed.data;
      signal.throwIfAborted();
      switch (operation) {
        case 'getStatus':
          return service.getStatus();
        case 'initialize':
          return service.initialize();
        case 'recall':
          return service.recall(input, maxBytes);
        case 'read':
          return service.read(input, maxBytes);
        case 'hasMissing':
          return service.hasMissing(memoryRefsSchema.parse(input));
        case 'remember':
          return service.remember(input, epoch === undefined ? undefined : { epoch, signal });
        case 'forget':
          return service.forget(input);
        case 'setPolicy':
          return service.setPolicy(input);
        case 'rebuildFts':
          return service.rebuildFts();
        case 'curationBegin': {
          const value = memoryCurationBeginSchema.parse(input);
          return curation.begin(value.sources, value.explicit, signal);
        }
        case 'curationNext': {
          const value = memoryCurationNextSchema.parse(input);
          return curation.next(value.id, value.proposals, signal);
        }
        case 'curationCancel':
          await curation.cancel(memoryCurationIdSchema.parse(input));
          return null;
        default:
          throw new MemoryError('INVALID_INPUT', '未知记忆操作。');
      }
    },
    /**
     * Cancel model continuations before draining and closing the sole connection.
     */
    async close() {
      await curation.close();
      await service.dispose();
    },
  };
}
