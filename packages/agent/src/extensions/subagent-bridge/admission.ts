/**
 * @author Codex
 * @description Validates immutable child launch scopes with their live parent without proxying tool execution.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export interface ChildAdmission {
  port: number;
  token: string;
  digest: string;
}

/**
 * Bind every authority field and session identity without exposing the serialized snapshot in URLs.
 */
export function admissionDigest(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Create one loopback-only parent admission endpoint; invalid credentials never reach the scope callback.
 */
export async function startChildAdmission(check: (digest: string) => Promise<boolean>) {
  const token = randomBytes(32).toString('hex');
  const server = createServer({ maxHeaderSize: 4096 }, (request, response) => {
    if (
      request.method !== 'GET' ||
      request.headers.authorization !== `Bearer ${token}` ||
      !/^\/admit\/[a-f0-9]{64}$/.test(request.url ?? '')
    ) {
      response.writeHead(403).end();
      return;
    }
    void check(request.url!.slice('/admit/'.length)).then(
      (allowed) => response.writeHead(allowed ? 204 : 409).end(),
      () => response.writeHead(409).end()
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('CHILD_ADMISSION_UNAVAILABLE');
  }
  return {
    /**
     * Produce a capability restricted to validating this exact immutable entry.
     */
    descriptor(key: string): ChildAdmission {
      return { port: address.port, token, digest: admissionDigest(key) };
    },
    /**
     * Close admission only; already admitted children retain their immutable snapshots.
     */
    async close(): Promise<void> {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

/**
 * Verify before any child tools register, including slash/API launches that bypass parent tool_call.
 */
export async function verifyChildAdmission(admission: ChildAdmission): Promise<void> {
  if (
    !admission ||
    !Number.isInteger(admission.port) ||
    admission.port < 1 ||
    admission.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(admission.token) ||
    !/^[a-f0-9]{64}$/.test(admission.digest)
  ) {
    throw new Error('CHILD_ADMISSION_INVALID: 请从父会话重新委派');
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${admission.port}/admit/${admission.digest}`, {
      headers: { authorization: `Bearer ${admission.token}` },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new Error('CHILD_ADMISSION_UNAVAILABLE: 父会话不可用，无法验证新子任务权限');
  }
  await response.body?.cancel();
  if (response.status !== 204) {
    throw new Error('CHILD_SCOPE_STALE: 父权限已变化或不可用，入口已请求刷新，请重新委派');
  }
}
