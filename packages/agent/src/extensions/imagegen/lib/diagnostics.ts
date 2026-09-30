/**
 * @author Codex
 * @description Bounds and redacts provider diagnostics before they enter durable tool results.
 */

/**
 * Removes known request secrets and common credential payloads before limiting display length.
 */
export function sanitizeImageDiagnostic(value: string, sensitive: readonly string[]): string {
  let message = value;
  for (const secret of sensitive.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]');
    message = message.split(encodeURIComponent(secret)).join('[redacted]');
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, '[url redacted]')
    .replace(/data:image\/[^\s"']+/gi, '[image redacted]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[\w-]+/g, '[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{256,}/g, '[payload redacted]')
    .replace(/\p{Cc}/gu, ' ')
    .slice(0, 2048);
}

/**
 * Reads only a bounded JSON error envelope; HTML and arbitrary response bodies stay private.
 * Reader failures preserve the original HTTP status and release the response stream.
 */
export async function imageHttpError(
  response: Response,
  sensitive: readonly string[]
): Promise<Error & { missingImageField: boolean }> {
  let missingImageField = false;
  const fields = [`Image provider request failed (HTTP ${response.status}).`];
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
  if (requestId) {
    fields.push(`request_id=${sanitizeImageDiagnostic(requestId, sensitive).slice(0, 256)}`);
  }
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (reader) {
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > 16 * 1024) {
          throw new Error('Diagnostic body exceeds limit');
        }
        chunks.push(value);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const error = body && typeof body === 'object' && 'error' in body ? body.error : body;
      // Validation gateways often return detail instead of an OpenAI error envelope.
      // Select diagnostic fields only: input and ctx may contain uploaded bytes or credentials.
      if (error && typeof error === 'object' && 'detail' in error) {
        const detail: unknown = error.detail;
        // This gateway explicitly rejects the upload field before image execution.
        // Match its exact message so unrelated validation or generation failures never trigger a resend.
        missingImageField =
          response.status === 422 &&
          (detail === 'image file is required' ||
            (Array.isArray(detail) &&
              detail.length > 0 &&
              detail.every(
                (entry: unknown) =>
                  entry !== null &&
                  typeof entry === 'object' &&
                  'type' in entry &&
                  entry.type === 'missing' &&
                  'loc' in entry &&
                  Array.isArray(entry.loc) &&
                  entry.loc.length === 2 &&
                  entry.loc[0] === 'body' &&
                  entry.loc[1] === 'image'
              )));
        if (typeof detail === 'string') {
          fields.push(`detail=${sanitizeImageDiagnostic(detail, sensitive).slice(0, 512)}`);
        } else {
          const entries = Array.isArray(detail) ? detail.slice(0, 8) : [detail];
          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
              continue;
            }
            const validation = entry as Record<string, unknown>;
            for (const key of ['type', 'msg']) {
              if (typeof validation[key] === 'string') {
                fields.push(`${key}=${sanitizeImageDiagnostic(validation[key], sensitive).slice(0, 256)}`);
              }
            }
            if (Array.isArray(validation.loc)) {
              const location = validation.loc
                .slice(0, 8)
                .filter(
                  (part): part is string | number => typeof part === 'string' || typeof part === 'number'
                )
                .map((part) => sanitizeImageDiagnostic(String(part), sensitive).slice(0, 128))
                .join('.');
              if (location) {
                fields.push(`loc=${location}`);
              }
            }
          }
        }
      }
      if (error && typeof error === 'object') {
        for (const key of ['code', 'type', 'param', 'message', 'request_id']) {
          const value: unknown = (error as Record<string, unknown>)[key];
          if (typeof value === 'string' || typeof value === 'number') {
            fields.push(`${key}=${value}`);
          }
        }
      }
    } catch {
      // HTTP status and header request ID remain useful when the body is not safe to parse.
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return Object.assign(new Error(sanitizeImageDiagnostic(fields.join(' '), sensitive)), {
    missingImageField,
  });
}
