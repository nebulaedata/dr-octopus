/**
 * @author Codex
 * @description PaddleOCR-VL page recognition over explicitly configured local vLLM endpoints.
 */
import { KnowledgeError } from '../../definitions/error.js';
import { knowledgeModelFetch, modelRequest, record } from './request.js';
import { ocrImageMime } from './ocr-image.js';
import type { OcrConfig } from '../../definitions/models.js';

/**
 * Send original image bytes with their detected MIME; reject truncated recognition results.
 */
export async function recognizePage(
  config: OcrConfig,
  image: Uint8Array,
  signal?: AbortSignal,
  fetcher: typeof fetch = knowledgeModelFetch
): Promise<string> {
  if (config.mode === 'off') {
    throw new KnowledgeError('OCR_NOT_CONFIGURED', 'OCR 已关闭');
  }
  const mime = ocrImageMime(image);
  if (mime === 'image/svg+xml') {
    throw new KnowledgeError('INVALID_INPUT', 'SVG 必须先通过图片预处理转换为 PNG');
  }
  const result = record(
    await modelRequest(
      config,
      'chat/completions',
      {
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${Buffer.from(image).toString('base64')}` },
              },
              { type: 'text', text: 'OCR:' },
            ],
          },
        ],
        temperature: 0,
        max_tokens: config.maxOutputTokens,
      },
      signal,
      fetcher
    )
  );
  if (!Array.isArray(result.choices) || result.choices.length !== 1) {
    throw new KnowledgeError('MODEL_RESPONSE_INVALID', 'OCR 响应格式无效');
  }
  const choice = record(result.choices[0]);
  const message = record(choice.message);
  if (choice.finish_reason !== 'stop' || typeof message.content !== 'string') {
    throw new KnowledgeError('OCR_INCOMPLETE', 'OCR 输出未完整结束，请检查页面和模型输出预算');
  }
  if (message.content.length > 200_000) {
    throw new KnowledgeError('OCR_INCOMPLETE', 'OCR 页面文本超过限制');
  }
  return message.content.trim();
}
