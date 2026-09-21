/**
 * @author Codex
 * @description Runs native image decoding in a disposable process with observable RSS and no model credentials.
 */
import { prepareOcrImage } from './ocr-image-preparation.js';
import { KnowledgeError } from '../definitions/error.js';

process.once('message', (bytes: Buffer) => {
  void run(bytes).catch(() => process.exit(1));
});

/**
 * Report either a bounded preparation result or a safe domain failure over private IPC.
 */
async function run(bytes: Buffer): Promise<void> {
  const heartbeat = setInterval(() => process.send?.({ rss: process.memoryUsage.rss() }), 200);
  try {
    const result = await prepareOcrImage(bytes);
    process.send?.({ result });
  } catch (error) {
    process.send?.({
      error: {
        code: error instanceof KnowledgeError ? error.code : 'OCR_IMAGE_PREPARATION_FAILED',
        message: error instanceof KnowledgeError ? error.message : '图片预处理失败',
      },
    });
  } finally {
    clearInterval(heartbeat);
  }
}
