/**
 * @author Codex
 * @description Retry-stable resumable knowledge uploads using the same tus client as ordinary attachments.
 */
import { Upload } from 'tus-js-client';
import { request } from '@/utils/request';
import { t } from '@/i18n/translate';

/**
 * Keep tus resume identity scoped to the explicit import request; never resume another workspace's file.
 */
export async function uploadKnowledgeSource(
  base: string,
  file: File,
  requestId: string
): Promise<{ sha256: string }> {
  const uploadUrl = await new Promise<string>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: '/api' + base + '/uploads/tus',
      chunkSize: 8 * 1024 ** 2,
      retryDelays: [0, 1000, 3000],
      metadata: { filename: file.name },
      headers: { 'Idempotency-Key': requestId },
      fingerprint: () =>
        Promise.resolve(`knowledge:${base}:${requestId}:${file.name}:${file.size}:${file.lastModified}`),
      removeFingerprintOnSuccess: true,
      onError: reject,
      onSuccess: () =>
        upload.url
          ? resolve(upload.url)
          : reject(new Error(t('api.knowledgeUpload.missingFileId', 'The upload did not return a file identity'))),
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous[0]) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      upload.start();
    }, reject);
  });
  const url = new URL(uploadUrl, location.origin);
  const expected = '/api' + base + '/uploads/tus/';
  if (url.origin !== location.origin || !url.pathname.startsWith(expected)) {
    throw new Error(t('api.knowledgeUpload.invalidAddress', 'The upload returned an invalid address'));
  }
  return request({ url: url.pathname.slice(4) + '/result', timeout: 120_000 });
}
