/**
 * @author Codex
 * @description Traces provider transport phases without retaining headers, prompts, credentials or response bodies.
 */

/**
 * Wraps a probe-owned fetch with timing events while preserving request options, stream errors and cancellation.
 */
export function traceProviderFetch(fetchImplementation, emit) {
  return async (input, init) => {
    const start = performance.now();
    let phase = 'request';
    let bytes = 0;
    let firstByte = false;
    let body;
    try {
      body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    } catch {
      body = {};
    }
    await emit({
      phase,
      elapsedMs: 0,
      requestBytes: typeof init?.body === 'string' ? Buffer.byteLength(init.body) : 0,
      maxOutputTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      jsonMode: body.response_format?.type === 'json_object',
      thinkingDisabled: body.enable_thinking === false,
      streaming: body.stream === true,
    });
    try {
      const response = await fetchImplementation(input, init);
      phase = 'headers';
      await emit({ phase, elapsedMs: Math.round(performance.now() - start), httpStatus: response.status });
      if (!response.body) {
        return response;
      }
      const reader = response.body.getReader();
      const stream = new ReadableStream(
        {
          /**
           * Reads only when the production compiler requests a chunk, preserving backpressure.
           */
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                await emit({
                  phase: 'body-complete',
                  elapsedMs: Math.round(performance.now() - start),
                  responseBytes: bytes,
                });
                reader.releaseLock();
                controller.close();
                return;
              }
              bytes += chunk.value.length;
              if (!firstByte) {
                firstByte = true;
                await emit({ phase: 'first-byte', elapsedMs: Math.round(performance.now() - start) });
              }
              controller.enqueue(chunk.value);
            } catch (error) {
              try {
                await emit({
                  phase: 'body-error',
                  elapsedMs: Math.round(performance.now() - start),
                  responseBytes: bytes,
                });
              } finally {
                reader.releaseLock();
                controller.error(error);
              }
            }
          },
          /**
           * Propagates bounded-response rejection and caller cancellation to the original body.
           */
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        },
        { highWaterMark: 0 }
      );
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      await emit({ phase: phase + '-error', elapsedMs: Math.round(performance.now() - start) });
      throw error;
    }
  };
}
