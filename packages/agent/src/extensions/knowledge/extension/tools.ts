/**
 * @author Codex
 * @description Thin built-in knowledge tools; all durable knowledge state belongs to the shared daemon.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { Type } from 'typebox';
import { createKnowledgeClient } from '../sdk/client.js';
import { scopeKnowledgeClient } from '../services/mode-policy.js';
import { KnowledgeError } from '../definitions/error.js';
import { registerSharedKnowledgeTools } from './shared-tools.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Register ordinary Agent tools under its existing permission gate; no service starts until a tool executes.
 */
export function registerKnowledgeTools(
  pi: ExtensionAPI,
  options: { agentDir: string; workspaceId: string; cwd: string },
  selection: () => readonly string[]
): void {
  const client = scopeKnowledgeClient(
    createKnowledgeClient({
      agentDir: options.agentDir,
      context: {
        principal: 'agent:' + options.workspaceId,
        workspaceId: options.workspaceId,
        globalWrite: true,
        modelAccess: 'invoke',
      },
    }),
    selection
  );
  registerSharedKnowledgeTools(pi, client);
  pi.registerTool({
    name: 'knowledge_import_attachment',
    label: '附件加入知识库',
    description:
      '把当前会话附件加入选定知识集合。attachmentRef 必须使用 Host 给出的 knowledge_import_ref，不能使用预览路径或自行编造。仅在用户要求保存到知识库时调用。',
    parameters: Type.Object(
      { collectionId: Type.String(), attachmentRef: Type.String({ minLength: 1, maxLength: 8192 }) },
      { additionalProperties: false }
    ),
    async execute(id, input, signal, _update, ctx) {
      const importer = scopeKnowledgeClient(
        createKnowledgeClient({
          agentDir: options.agentDir,
          context: {
            principal: 'agent:' + options.workspaceId,
            workspaceId: options.workspaceId,
            agentSessionId: ctx.sessionManager.getSessionId(),
            globalWrite: true,
            modelAccess: 'invoke',
          },
        }),
        selection
      );
      const result = await importer.call('jobs.importAttachment', { ...input, requestId: id }, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'knowledge_create_collection',
    label: '创建知识集合',
    description: '根据用户意图创建知识集合。默认仅当前工作区，global 表示所有工作区共享。',
    parameters: Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 120 }),
        description: Type.Optional(Type.String({ maxLength: 2000 })),
        scope: Type.Optional(Type.Union([Type.Literal('workspace'), Type.Literal('global')])),
      },
      { additionalProperties: false }
    ),
    async execute(_id, input, signal) {
      const result = await client.call(
        'collections.create',
        {
          name: input.name,
          description: input.description,
          scope:
            input.scope === 'global'
              ? { kind: 'global' }
              : { kind: 'workspace', workspaceId: options.workspaceId },
        },
        signal
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'knowledge_add_text',
    label: '新增知识文本',
    description: '把用户授权保存的正文加入知识集合。返回任务 ID；入库成功以任务结果为准。',
    parameters: Type.Object(
      {
        collectionId: Type.String(),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        text: Type.String({ minLength: 1, maxLength: 500_000 }),
      },
      { additionalProperties: false }
    ),
    async execute(id, input, signal) {
      const blob = await client.upload(Buffer.from(input.text, 'utf8'), signal);
      const result = await client.call(
        'jobs.import',
        {
          collectionId: input.collectionId,
          requestId: id,
          source: { title: input.title + '.md', format: 'md', blobSha256: blob.sha256 },
        },
        signal
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'knowledge_import',
    label: '导入知识文档',
    description: '导入工作区内的文档或压缩包；路径必须相对工作区。压缩包可递归解析。返回异步任务 ID。',
    parameters: Type.Object(
      { collectionId: Type.String(), path: Type.String({ minLength: 1, maxLength: 2000 }) },
      { additionalProperties: false }
    ),
    async execute(id, input, signal) {
      if (isAbsolute(input.path)) {
        throw new KnowledgeError('INVALID_INPUT', '知识导入只接受相对工作区路径');
      }
      const root = await realpath(options.cwd);
      const path = await realpath(resolve(root, input.path));
      const rel = relative(root, path);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel) {
        throw new KnowledgeError('FORBIDDEN', '文件不在当前工作区内');
      }
      const details = await stat(path);
      if (!details.isFile() || details.size > 100 * 1024 * 1024) {
        throw new KnowledgeError('INVALID_INPUT', '文件无效或超过 100 MiB');
      }
      const blob = await client.upload(await readFile(path, { signal }), signal);
      const title = basename(path);
      const format = /\.(tgz|tar\.gz)$/iu.test(title) ? 'tgz' : title.split('.').at(-1)!.toLowerCase();
      const result = await client.call(
        'jobs.import',
        {
          collectionId: input.collectionId,
          requestId: id,
          source: { title, format, blobSha256: blob.sha256 },
        },
        signal
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({
    name: 'knowledge_job_status',
    label: '知识导入状态',
    description: '查看知识导入或索引任务结果，包括压缩包每个文档的成功、失败或跳过原因。',
    parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }),
    async execute(_id, input, signal) {
      const result = await client.call('jobs.get', input, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
    },
  });
}
