/**
 * The Axios instance every non-streaming call goes through.
 *
 * Responsibilities stop at transport: it addresses the service, applies a
 * timeout, and normalises failures into one `ApiError` type. It does not know
 * about React, React Query or view models.
 */

import axios, { AxiosError, type AxiosInstance } from 'axios';

import { env } from '@infrastructure/config/env';
import type { ErrorEnvelopeDTO } from '@infrastructure/types/api';

/**
 * A transport or backend failure, normalised.
 *
 * `code` is the backend's `AppError.code` when the response carried one
 * (app/api/errors.py), and a synthetic client code otherwise.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    options: { code: string; status?: number | null; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.details = options.details ?? {};
  }

  /** True when retrying could plausibly succeed. */
  get isRetryable(): boolean {
    if (this.status === null) return true; // network-level failure
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelopeDTO {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { message?: unknown }).message === 'string'
  );
}

/** Translate anything Axios can throw into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<unknown>;
    const status = axiosError.response?.status ?? null;
    const body = axiosError.response?.data;

    if (isErrorEnvelope(body)) {
      return new ApiError(body.error.message, {
        code: body.error.code,
        status,
        details: body.error.details ?? {},
      });
    }

    if (axiosError.code === 'ECONNABORTED') {
      return new ApiError('The service did not respond in time.', {
        code: 'timeout',
        status,
      });
    }

    if (status === null) {
      return new ApiError(
        'Could not reach the Access Advisor service. Check that it is running.',
        { code: 'network_unreachable', status: null },
      );
    }

    return new ApiError(axiosError.message || `Request failed with status ${status}.`, {
      code: 'http_error',
      status,
    });
  }

  return new ApiError(error instanceof Error ? error.message : 'Unexpected error.', {
    code: 'unknown',
  });
}

export const httpClient: AxiosInstance = axios.create({
  baseURL: `${env.apiBaseUrl}${env.apiPrefix}`,
  timeout: env.apiTimeoutMs,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toApiError(error)),
);
