/**
 * @author Codex
 * @description Provides the shared Axios transport boundary for Web API modules.
 */

import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'content-type': 'application/json' },
  timeout: 20_000,
});

/**
 * Preserves the stable Server error contract across the Axios transport boundary.
 */
export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly options: {
    statusCode?: number;
    retryable: boolean;
    requestId?: string;
    cause?: unknown;
  };

  /**
   * Creates one typed API failure suitable for query retry decisions.
   *
   * @param code Stable machine-readable Server error code.
   * @param message Safe user-facing failure message.
   * @param options Optional HTTP and retry metadata.
   */
  public constructor(
    code: string,
    message: string,
    options: {
      statusCode?: number;
      retryable: boolean;
      requestId?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiRequestError';
    this.code = code;
    this.options = options;
  }

  /**
   * Returns the HTTP status when the failure received a Server response.
   */
  public get statusCode(): number | undefined {
    return this.options.statusCode;
  }

  /**
   * Returns whether the Server declared this failure safe to retry.
   */
  public get retryable(): boolean {
    return this.options.retryable;
  }

  /**
   * Returns the Server request identity used for log correlation.
   */
  public get requestId(): string | undefined {
    return this.options.requestId;
  }
}

/**
 * Executes a typed API request and hides Axios response and error contracts from callers.
 *
 * @param config Axios request configuration owned by an API module.
 * @returns The decoded response payload.
 * @throws A stable Error containing the server message when the request fails.
 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await api.request<T>(config);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError<unknown>(error)) {
      const response = error.response;
      const statusCode = response?.status;
      const payload = response?.data;
      const envelope = isErrorRecord(payload) && 'error' in payload ? payload.error : payload;
      const projected = isErrorRecord(envelope) ? envelope : undefined;
      const code = typeof projected?.code === 'string' ? projected.code : 'NETWORK_ERROR';
      const message =
        typeof projected?.message === 'string' && projected.message.trim()
          ? projected.message
          : error.message;
      const DEFAULT_RETRYABLE_STATUS = [429, 500, 502, 503, 504];
      const DEFAULT_RETRYABLE = statusCode === undefined || DEFAULT_RETRYABLE_STATUS.includes(statusCode);
      const retryable = typeof projected?.retryable === 'boolean' ? projected.retryable : DEFAULT_RETRYABLE;
      const requestId = typeof projected?.requestId === 'string' ? projected.requestId : undefined;
      throw new ApiRequestError(code, message, {
        ...(statusCode === undefined ? {} : { statusCode }),
        ...(requestId === undefined ? {} : { requestId }),
        retryable,
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Narrows proxy and API error bodies before reading fields, including empty and non-JSON responses.
 */
function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
