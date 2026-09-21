/**
 * @author Codex
 * @description 以原子写和进程内串行化持久化 Pi 模型与默认设置
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { ModelConfigRepository, SettingsRepository } from '../../definitions/port.js';

let writeQueue = Promise.resolve();

/**
 * @description 串行执行配置写入。
 * @param operation 写操作。
 * @returns 写操作结果。
 */
async function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * @description 原子写入 JSON 文件。
 * @param path 目标路径。
 * @param value JSON 值。
 */
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

/**
 * @description 合并写入 Pi models.json 的 Repository。
 */
export class PiModelConfigRepository implements ModelConfigRepository {
  /**
   * @description 创建 Repository。
   * @param path models.json 路径。
   */
  public constructor(private readonly path: string) {}
  /**
   * @description 新增或替换本地 Provider。
   * @param providerId Provider ID。
   * @param baseUrl API URL。
   * @param modelId 模型 ID。
   */
  public async upsertLocalProvider(providerId: string, baseUrl: string, modelId: string): Promise<void> {
    await serialize(async () => {
      let current: { providers?: Record<string, unknown> } = {};
      try {
        current = JSON.parse(await readFile(this.path, 'utf8')) as typeof current;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      current.providers ??= {};
      current.providers[providerId] = {
        baseUrl: baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`,
        api: 'openai-completions',
        apiKey: providerId,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [
          {
            id: modelId,
            name: `${modelId} (Local)`,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      };
      await writeJson(this.path, current);
    });
  }
}

/**
 * @description 使用 Pi SettingsManager 写入全局默认模型。
 */
export class PiSettingsRepository implements SettingsRepository {
  private readonly manager: SettingsManager;
  private readonly path: string;
  /**
   * @description 创建 Repository。
   * @param agentDir Pi agent 配置目录。
   */
  public constructor(agentDir: string) {
    this.path = join(agentDir, 'settings.json');
    this.manager = SettingsManager.create(process.cwd(), agentDir, { projectTrusted: false });
  }
  /**
   * @description 判断全局 Pi settings.json 是否存在。
   * @returns 文件存在时为 true。
   */
  public async exists(): Promise<boolean> {
    try {
      await access(this.path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }
  /**
   * @description 读取默认模型。
   * @returns Provider 与模型 ID。
   */
  public async getDefaultModel(): Promise<{ providerId?: string; modelId?: string }> {
    await this.manager.reload();
    const providerId = this.manager.getDefaultProvider();
    const modelId = this.manager.getDefaultModel();
    return { ...(providerId ? { providerId } : {}), ...(modelId ? { modelId } : {}) };
  }
  /**
   * @description 写入默认模型。
   * @param providerId Provider ID。
   * @param modelId 模型 ID。
   */
  public async setDefaultModel(providerId: string, modelId: string): Promise<void> {
    this.manager.setDefaultModelAndProvider(providerId, modelId);
    await this.manager.flush();
  }
}
