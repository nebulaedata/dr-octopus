/**
 * @author Codex
 * @description Loads the installed public subagent API and writes immutable child entries with narrowly scoped parent admission capabilities.
 */
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createJiti } from 'jiti';
import { CHILD_TOOLS } from './contracts.js';
import type { ChildAdmission } from './admission.js';
import type { ChildScope, RequiredChildApi } from './contracts.js';

/**
 * Resolve public exports from the same agentDir npm installation used by Pi, including TypeScript exports.
 */
export async function loadRequiredChildApi(agentDir: string): Promise<RequiredChildApi> {
  const require = createRequire(join(agentDir, 'npm', 'package.json'));
  const path = require.resolve('pi-subagents/required-child-extensions');
  const api = await createJiti(import.meta.url).import<RequiredChildApi>(path);
  if (typeof api.registerRequiredChildExtensions !== 'function') {
    throw new Error('Installed pi-subagents does not expose required child extensions');
  }
  return api;
}

/**
 * Retain launch snapshots and parent admission capabilities for detached and nested children; no model credentials.
 */
export async function ensureChildEntry(scope: ChildScope, admission: ChildAdmission): Promise<string> {
  const suffix = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const entry = fileURLToPath(new URL(`./child-entry.${suffix}`, import.meta.url));
  await readFile(entry);
  const admissionModule = new URL(`./admission.${suffix}`, import.meta.url).href;
  const source =
    `/**\n * @author Codex\n * @description Host-managed immutable child retrieval entry.\n */\n` +
    `import { createScopedChildExtension } from ${JSON.stringify(pathToFileURL(entry).href)};\n` +
    `/**\n * Register shared built-in tools under the parent capability snapshot.\n */\n` +
    `export default async function childEntry(pi) {\n` +
    `  const { verifyChildAdmission } = await import(${JSON.stringify(admissionModule)});\n` +
    `  await verifyChildAdmission(${JSON.stringify(admission)});\n` +
    `  createScopedChildExtension(${JSON.stringify(scope)})(pi);\n` +
    `}\n`;
  const directory = join(scope.agentDir, 'octopus-child-entries');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, createHash('sha256').update(source).digest('hex') + '.mjs');
  const temporary = join(directory, randomUUID() + '.tmp');
  try {
    await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
    // Publish only complete bytes: another parent must never import a partially written module.
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await readFile(path, 'utf8')) !== source) {
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

/**
 * Maintain the reserved built-in agent definition without rewriting identical content on each launch.
 */
export async function ensureExplorerAgent(agentDir: string): Promise<void> {
  const directory = join(agentDir, 'agents');
  const path = join(directory, 'octopus-explorer.md');
  const source = `---\nname: octopus-explorer\ndescription: Octopus 知识与记忆检索、OCR、向量化与重排；能力受父会话权限限制\nsystemPromptMode: append\ninheritProjectContext: true\ntools: read, grep, find, ls, ${CHILD_TOOLS.join(', ')}\ninheritSkills: false\n---\n\n先用 knowledge_list_collections 获取集合后 knowledge_search，再 knowledge_read 阅读引用；记忆先 memory_recall 再 memory_read。图片文字识别用 ocr_image，文本向量化用 embed_text，相关性重排用 rerank_documents；这些工具不要求选择知识集合。工具不可用时说明限制，不得绕过。保持回答聚焦。\n`;
  await mkdir(directory, { recursive: true });
  try {
    if ((await readFile(path, 'utf8')) === source) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const temporary = join(directory, `.octopus-explorer-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        // Windows can briefly lock the destination while another parent reads or replaces it.
        if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error;
        }
        if ((await readFile(path, 'utf8').catch(() => undefined)) === source) {
          break;
        }
        if (attempt === 5) {
          throw error;
        }
        await delay(20 * 2 ** attempt);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
