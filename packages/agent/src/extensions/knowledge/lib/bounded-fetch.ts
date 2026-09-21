/**
 * @author Codex
 * @description Bounded outbound HTTP with DNS checks at connect time and no credential-bearing redirects.
 */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { KnowledgeError } from '../definitions/error.js';

/**
 * Permit explicitly configured local/private hosts while rejecting unspecified, multicast and metadata destinations.
 */
function allowedAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    return allowedAddress(value.slice(7));
  }
  if (isIP(value) === 4) {
    const [first, second] = value.split('.').map(Number);
    return first !== 0 && first! < 224 && !(first === 169 && second === 254) && value !== '100.100.100.200';
  }
  return isIP(value) === 6 && value !== '::' && !/^fe[89ab]/u.test(value) && !value.startsWith('ff');
}

/**
 * Support the SDK's fetch surface without buffering unbounded streams or following redirects.
 */
export async function boundedKnowledgeFetch(
  input: string | URL | Request,
  init?: RequestInit,
  maxBytes = 4 * 1024 * 1024
): Promise<Response> {
  const source = input instanceof Request ? input : undefined;
  const url = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new KnowledgeError('INVALID_ENDPOINT', '连接地址必须为无凭据和查询参数的 HTTP(S) 地址');
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(hostname) && !allowedAddress(hostname)) {
    throw new KnowledgeError('INVALID_ENDPOINT', '目标网络地址不允许');
  }
  const signal = init?.signal ?? source?.signal;
  signal?.throwIfAborted();
  const headers = new Headers(source?.headers);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const payload = init?.body ?? (source && source.method !== 'GET' ? await source.text() : undefined);
  if (
    payload !== null &&
    payload !== undefined &&
    typeof payload !== 'string' &&
    !(payload instanceof Uint8Array)
  ) {
    throw new KnowledgeError('INVALID_INPUT', '不支持流式请求正文');
  }
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: init?.method ?? source?.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        signal: signal ?? undefined,
        lookup: (host, options, callback) => {
          void lookup(host, { all: true }).then(
            (addresses) => {
              if (!addresses.length || addresses.some((item) => !allowedAddress(item.address))) {
                callback(new Error('Knowledge endpoint address rejected'), '', 4);
              } else if (options.all) {
                callback(null, addresses);
              } else {
                callback(null, addresses[0]!.address, addresses[0]!.family);
              }
            },
            (error: Error) => callback(error, '', 4)
          );
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new KnowledgeError('RESPONSE_TOO_LARGE', '远端响应超过限制'));
          } else {
            chunks.push(chunk);
          }
        });
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode ?? 502;
          const outputHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              outputHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          resolve(
            new Response([204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks)), {
              status,
              headers: outputHeaders,
            })
          );
        });
      }
    );
    request.setTimeout(120_000, () =>
      request.destroy(new KnowledgeError('UNAVAILABLE', '远端请求超时', true))
    );
    request.on('error', reject);
    request.end(payload);
  });
}
