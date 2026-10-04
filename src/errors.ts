import type { ProviderValueV1 } from './shared'

export type ProviderErrorCodeV1 =
  | 'INVALID_ARGUMENT'
  | 'NOT_SUPPORTED'
  | 'NOT_AUTHENTICATED'
  | 'AUTH_EXPIRED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PATH_OUTSIDE_CACHE'
  | 'PERMISSION_DENIED'
  | 'INCOMPATIBLE_API'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_CRASHED'
  | 'INTERNAL'

export interface ProviderErrorV1 {
  code: ProviderErrorCodeV1
  message: string
  retryable: boolean
  retryAfterMs?: number
  details?: Record<string, ProviderValueV1>
}

export type ProviderResultV1<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderErrorV1 }

export class ProviderApiError extends Error {
  readonly providerError: ProviderErrorV1

  constructor(error: ProviderErrorV1) {
    super(error.message)
    this.name = 'ProviderApiError'
    this.providerError = error
  }
}

export function providerError(
  code: ProviderErrorCodeV1,
  message: string,
  options: Omit<ProviderErrorV1, 'code' | 'message'> = { retryable: false },
): ProviderErrorV1 {
  return { code, message, ...options }
}
