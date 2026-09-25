/**
 * @author Codex
 * @description Adapts OpenAI Images and Gemini generation to Pi's public image contract.
 */
import { imageHttpError } from './diagnostics.js';
import type {
  AssistantImages,
  ImagesContext,
  ImagesModel,
  ImagesApi,
  ImagesOptions,
  ImageContent,
  TextContent,
  Usage,
} from '@earendil-works/pi-ai';

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

interface ImageProviderResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> };
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Reads a bounded provider response and preserves only sanitized HTTP diagnostics.
 */
async function readResponse(response: Response, sensitive: readonly string[]): Promise<Uint8Array> {
  if (!response.ok) {
    throw await imageHttpError(response, sensitive);
  }
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) {
    throw new Error('Image provider returned an empty response.');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error('Image provider response exceeds 64 MiB.');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Merges resolved provider headers while respecting explicit null suppression.
 */
function requestHeaders(model: ImagesModel<ImagesApi>, options: ImagesOptions, google: boolean): Headers {
  const headers = new Headers(
    google ? { 'x-goog-api-key': options.apiKey ?? '' } : { Authorization: `Bearer ${options.apiKey ?? ''}` }
  );
  for (const [key, value] of Object.entries({ ...model.headers, ...options.headers })) {
    if (value === null) {
      headers.delete(key);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Converts reported token counts; native image monetary pricing remains unpriced.
 */
function usage(input: number | undefined, output: number | undefined): Usage | undefined {
  if (
    input === undefined ||
    output === undefined ||
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  ) {
    return undefined;
  }
  return {
    input,
    output,
    totalTokens: input + output,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Executes one non-retried generation or edit with a provider-neutral return shape.
 */
export async function generateDirectImages(
  model: ImagesModel<ImagesApi>,
  context: ImagesContext,
  options: ImagesOptions = {}
): Promise<AssistantImages> {
  const google = model.api === 'google-gemini';
  const headers = requestHeaders(model, options, google);
  const prompt = context.input
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const references = context.input.filter((part): part is ImageContent => part.type === 'image');
  const sensitive = [
    options.apiKey ?? '',
    ...headers.values(),
    prompt,
    ...references.map((part) => part.data),
  ];
  const base = model.baseUrl.replace(/\/+$/, '');
  let url: string;
  let body: string | FormData;
  if (google) {
    url = `${base.replace(/\/v1beta$/, '')}/v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
    body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: context.input.map((part) =>
            part.type === 'text'
              ? { text: part.text }
              : { inlineData: { mimeType: part.mimeType, data: part.data } }
          ),
        },
      ],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    headers.set('Content-Type', 'application/json');
  } else if (references.length) {
    url = `${base}/images/edits`;
    const form = new FormData();
    form.set('model', model.id);
    form.set('prompt', prompt);
    references.forEach((reference, index) =>
      form.append(
        'image[]',
        new Blob([Buffer.from(reference.data, 'base64')], { type: reference.mimeType }),
        `reference-${index}.${reference.mimeType.split('/')[1]}`
      )
    );
    headers.delete('Content-Type');
    body = form;
  } else {
    url = `${base}/images/generations`;
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify({ model: model.id, prompt, n: 1 });
  }
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers,
    body,
    signal: options.signal,
  });
  const result = JSON.parse(
    Buffer.from(await readResponse(response, sensitive)).toString('utf8')
  ) as ImageProviderResponse;
  const output: Array<ImageContent | TextContent> = [];
  if (google) {
    for (const part of result.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.inlineData?.data === 'string' && typeof part.inlineData.mimeType === 'string') {
        output.push({ type: 'image', data: part.inlineData.data, mimeType: part.inlineData.mimeType });
      }
      if (typeof part.text === 'string') {
        output.push({ type: 'text', text: part.text });
      }
    }
  } else {
    for (const item of result.data ?? []) {
      if (typeof item.b64_json === 'string') {
        output.push({ type: 'image', data: item.b64_json, mimeType: 'image/png' });
      } else if (typeof item.url === 'string') {
        const download = new URL(item.url);
        if (download.protocol !== 'https:' || download.username || download.password) {
          throw new Error('Image provider returned an unsupported download URL.');
        }
        const bytes = await readResponse(
          await (options.fetch ?? fetch)(download, { signal: options.signal, redirect: 'error' }),
          sensitive
        );
        output.push({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' });
      }
      if (typeof item.revised_prompt === 'string') {
        output.push({ type: 'text', text: item.revised_prompt });
      }
    }
  }
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: google
      ? usage(result.usageMetadata?.promptTokenCount, result.usageMetadata?.candidatesTokenCount)
      : usage(result.usage?.input_tokens, result.usage?.output_tokens),
  };
}
