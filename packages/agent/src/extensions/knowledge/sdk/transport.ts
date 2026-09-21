/**
 * @author Codex
 * @description Identity-bound local daemon requests without Pi, parser, model or database imports.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeError } from '../definitions/error.js';
import { readKnowledgeMetadata } from '../lib/profile.js';
import type { KnowledgeProfile } from '../lib/profile.js';
import type { KnowledgeEndpoint } from '../definitions/lifecycle.js';

/**
 * Validate every endpoint before constructing a loopback URL.
 */
export async function discoverKnowledge(profile: KnowledgeProfile): Promise<KnowledgeEndpoint | null> {
  const endpoint = await readKnowledgeMetadata<KnowledgeEndpoint>(join(profile.directory, 'endpoint.json'));
  if (!endpoint) {
    return null;
  }
  if (
    endpoint.protocolVersion !== 1 ||
    endpoint.profileId !== profile.profileId ||
    typeof endpoint.daemonId !== 'string' ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  ) {
    throw new KnowledgeError('KNOWLEDGE_VERSION_CONFLICT', '知识服务身份或协议不兼容，请重启服务');
  }
  return endpoint;
}

/**
 * Call the exact discovered daemon with bounded responses and explicit cancellation.
 */
export async function knowledgeRequest<T>(
  profile: KnowledgeProfile,
  endpoint: KnowledgeEndpoint,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = 30_000
): Promise<T> {
  const token = await readFile(join(profile.directory, 'control-token'), 'utf8');
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/knowledge/v1/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'x-knowledge-profile': profile.profileId,
      'x-knowledge-daemon': endpoint.daemonId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    redirect: 'error',
  });
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        const bytes: unknown = next.value;
        if (!(bytes instanceof Uint8Array) || (size += bytes.byteLength) > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new KnowledgeError('KNOWLEDGE_RESPONSE_INVALID', '知识服务响应超过限制');
        }
        parts.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as T;
  if (!response.ok) {
    const failure = value as { code?: string; message?: string; retryable?: boolean };
    throw new KnowledgeError(
      failure.code ?? 'KNOWLEDGE_UNAVAILABLE',
      failure.message ?? '知识服务不可用',
      failure.retryable
    );
  }
  return value;
}
