/**
 * @author Codex
 * @description Lightweight daemon client retaining Host scope outside model-controlled tool arguments.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import { knowledgeProfile } from '../lib/profile.js';
import { startKnowledgeService } from './lifecycle.js';
import { discoverKnowledge, knowledgeRequest } from './transport.js';
import type { KnowledgeClient, KnowledgeClientOptions, KnowledgeOperations } from '../definitions/client.js';

/**
 * Construct a lazy client without starting a service, opening a database or loading native modules.
 */
export function createKnowledgeClient(options: KnowledgeClientOptions): KnowledgeClient {
  const context = { ...options.context };
  /**
   * Resolve discovery afresh for every operation so a restarted daemon cannot be confused with the prior owner.
   */
  async function connection() {
    if (options.autostart !== false) {
      await startKnowledgeService(options.agentDir, 30_000, false);
    }
    const profile = await knowledgeProfile(options.agentDir);
    const endpoint = profile ? await discoverKnowledge(profile) : null;
    if (!profile || !endpoint) {
      throw new KnowledgeError('KNOWLEDGE_UNAVAILABLE', '知识服务尚未启动');
    }
    return { profile, endpoint };
  }
  return {
    /**
     * Submit a bounded typed operation with the immutable caller context.
     */
    async call<K extends keyof KnowledgeOperations>(
      operation: K,
      input: KnowledgeOperations[K]['input'],
      signal?: AbortSignal
    ) {
      const { profile, endpoint } = await connection();
      return knowledgeRequest<KnowledgeOperations[K]['output']>(
        profile,
        endpoint,
        'call',
        { operation, input, context },
        signal,
        120_000
      );
    },
    /**
     * Upload bounded binary content without base64 copies or arbitrary server filesystem paths.
     */
    async upload(bytes, signal) {
      if (!bytes.length || bytes.length > 100 * 1024 * 1024) {
        throw new KnowledgeError('INVALID_INPUT', '文件为空或超过 100 MiB');
      }
      const { profile, endpoint } = await connection();
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/knowledge/v1/blobs`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + (await readFile(join(profile.directory, 'control-token'), 'utf8')),
          'x-knowledge-profile': profile.profileId,
          'x-knowledge-daemon': endpoint.daemonId,
          'content-type': 'application/octet-stream',
        },
        body: Buffer.from(bytes),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
          : AbortSignal.timeout(120_000),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new KnowledgeError('UPLOAD_FAILED', '知识原文上传失败', true);
      }
      return (await response.json()) as { sha256: string; size: number };
    },
  };
}
