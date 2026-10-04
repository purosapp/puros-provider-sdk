import { API_VERSION, PROVIDER_ID_PATTERN, RESERVED_PROVIDER_IDS, type ProviderId } from './shared'

export function isValidProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string'
    && PROVIDER_ID_PATTERN.test(value)
    && !(RESERVED_PROVIDER_IDS as readonly string[]).includes(value)
}

export function isProviderApiCompatible(value: { apiVersion?: unknown }): boolean {
  return value.apiVersion === API_VERSION
}
