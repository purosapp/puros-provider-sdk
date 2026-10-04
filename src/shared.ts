export const API_VERSION = 1 as const
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/
// Core-owned `source` values: `local` library rows and `m3u` playlist imports.
export const RESERVED_PROVIDER_IDS = ['local', 'm3u'] as const

export type ProviderApiVersionV1 = typeof API_VERSION
export type ProviderId = string
export type ProviderPrimitiveV1 = string | number | boolean | null
export type ProviderValueV1 =
  | ProviderPrimitiveV1
  | ProviderValueV1[]
  | { [key: string]: ProviderValueV1 }
