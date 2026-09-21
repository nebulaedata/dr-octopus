/**
 * @author Codex
 * @description Bounded no-redirect JSON requests with optional authentication and cancellation.
 */
import { KnowledgeError } from '../../definitions/error.js';
import { boundedKnowledgeFetch } from '../bounded-fetch.js';
import type { ModelConnection } from '../../definitions/models.js';

/**
 * Enforce DNS and byte limits while preserving injectable fetch adapters for contract tests.
 */
export const knowledgeModelFetch: typeof fetch = (input, init) =>
  boundedKnowledgeFetch(input, init, 16 * 1024 * 1024);

/**
 * Accept explicitly configured internal HTTP services without leaking credentials through URLs.
 */
export function modelEndpoint(base: string, route: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', '模型地址不是有效 URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /^(169\.254\.|0\.0\.0\.0$|\[?fe80:)/iu.test(url.hostname)
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', '模型地址必须使用不含凭据的 HTTP(S) 地址');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '') + '/' + route;
  return url;
}

/**
 * Parse a bounded provider response; never echo a remote error body into logs or UI.
 */
export async function modelRequest(
  connection: ModelConnection,
  route: string,
  payload: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = knowledgeModelFetch
): Promise<unknown> {
  if (
    !connection.model.trim() ||
    !Number.isInteger(connection.timeoutMs) ||
    connection.timeoutMs < 100 ||
    connection.timeoutMs > 120_000
  ) {
    throw new KnowledgeError('MODEL_CONFIG_INVALID', '模型名称或超时配置无效');
  }
  const endpoint = modelEndpoint(connection.endpoint, route);
  const timeout = AbortSignal.timeout(connection.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (connection.apiKey?.trim()) {
    headers.authorization = `Bearer ${connection.apiKey}`;
  }
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new KnowledgeError(
        'MODEL_REQUEST_FAILED',
        `模型请求失败（HTTP ${response.status}）`,
        response.status === 429 || response.status >= 500
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new KnowledgeError('MODEL_RESPONSE_INVALID', '模型返回空响应');
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const item = await reader.read();
        if (item.done) {
          break;
        }
        const value: unknown = item.value;
        if (!(value instanceof Uint8Array)) {
          throw new KnowledgeError('MODEL_RESPONSE_INVALID', '模型响应流格式无效');
        }
        size += value.byteLength;
        if (size > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new KnowledgeError('MODEL_RESPONSE_INVALID', '模型响应超过大小限制');
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch (cause) {
    if (signal?.aborted) {
      throw new KnowledgeError('CANCELLED', '操作已取消', false, { cause });
    }
    if (cause instanceof KnowledgeError) {
      throw cause;
    }
    throw new KnowledgeError(
      timeout.aborted ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE',
      timeout.aborted ? '模型请求超时' : '模型连接或响应无效',
      true,
      { cause }
    );
  }
}

/**
 * Narrow untrusted provider objects without unsafe casts at consumers.
 */
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KnowledgeError('MODEL_RESPONSE_INVALID', '模型响应格式无效');
  }
  return value as Record<string, unknown>;
}
