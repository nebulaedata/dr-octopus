/**
 * @author Codex
 * @description Adapts OpenAI Images and Qwen DashScope generation to Pi's public image contract.
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
  output?: { choices?: Array<{ message?: { content?: Array<{ text?: string; image?: string }> } }> };
  code?: string;
  message?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
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
function requestHeaders(model: ImagesModel<ImagesApi>, options: ImagesOptions): Headers {
  const headers = new Headers({ Authorization: `Bearer ${options.apiKey ?? ''}` });
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
 * Executes generation or editing; retries a single-image field only after an explicit pre-execution rejection.
 */
export async function generateDirectImages(
  model: ImagesModel<ImagesApi>,
  context: ImagesContext,
  options: ImagesOptions = {}
): Promise<AssistantImages> {
  if (!['openai-images', 'qwen-images'].includes(model.api)) {
    throw new Error('Unsupported image protocol.');
  }
  const qwen = model.api === 'qwen-images';
  const headers = requestHeaders(model, options);
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
  if (qwen) {
    url = `${base}/services/aigc/multimodal-generation/generation`;
    body = JSON.stringify({
      model: model.id,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              ...references.map((part) => ({ image: `data:${part.mimeType};base64,${part.data}` })),
              { text: prompt },
            ],
          },
        ],
      },
      parameters: { n: 1 },
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
  const fetchImage = options.fetch ?? fetch;
  const request = { method: 'POST', headers, body, signal: options.signal, redirect: 'error' as const };
  let response = await fetchImage(url, request);
  if (!qwen && references.length === 1 && body instanceof FormData && !response.ok) {
    const failure = await imageHttpError(response, sensitive);
    if (!failure.missingImageField) {
      throw failure;
    }
    // The gateway rejected the upload before generation. Rename the one file, keeping every other field.
    // Multiple references never fall back: a singular field cannot preserve their ordered contract.
    options.signal?.throwIfAborted();
    const upload = body.get('image[]') as File;
    body.delete('image[]');
    body.set('image', upload, upload.name);
    response = await fetchImage(url, request);
  }
  const result = JSON.parse(
    Buffer.from(await readResponse(response, sensitive)).toString('utf8')
  ) as ImageProviderResponse;
  const output: Array<ImageContent | TextContent> = [];
  if (result.code) {
    throw new Error(`Image provider rejected the request: ${result.code}. ${result.message ?? ''}`);
  }
  const items = qwen
    ? (result.output?.choices?.[0]?.message?.content ?? []).map((part) => ({
        url: part.image,
        revised_prompt: part.text,
        b64_json: undefined,
      }))
    : (result.data ?? []);
  for (const item of items) {
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
  if (!output.some((part) => part.type === 'image')) {
    throw new Error('Image provider returned no images.');
  }
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output,
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: usage(result.usage?.input_tokens, result.usage?.output_tokens),
  };
}
