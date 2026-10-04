import type { ProviderCapabilityV1 } from './capabilities'
import type { ProviderApiVersionV1, ProviderId, ProviderValueV1 } from './shared'

/**
 * Host features added after the original v1 contract. A provider that relies on
 * one lists it in `requiredHostFeatures`; hosts reject a manifest naming a
 * feature they lack, and hosts that predate the field reject it as unknown, so
 * an incompatible package never activates.
 */
export const PROVIDER_HOST_FEATURES_V1 = [
  /** `VORBIS` in `AudioFormatV1` and host format validation. */
  'audio-format.vorbis',
  /** `sourceFormat` on playback artifacts and host cache entries. */
  'playback.source-format',
  /** `host.cache.canPlayFormat`. */
  'playback.format-support',
  /** `OPUS` in `AudioFormatV1`, host format validation, and `canPlayFormat`. */
  'audio-format.opus',
  /** `form` setting controls whose submitted values reach one capability method. */
  'settings.form',
  /**
   * `host.openAuthWindow` browser sign-in: in-memory partitions wiped when the
   * window closes, `cookieJar` collection, and `userAgent: 'browser'`.
   */
  'auth.browser-session',
] as const

export type ProviderHostFeatureV1 = typeof PROVIDER_HOST_FEATURES_V1[number]

export interface ProviderManifestV1 {
  schemaVersion: 1
  apiVersion: ProviderApiVersionV1
  id: ProviderId
  version: string
  displayName: string
  description?: string
  homepage?: string
  icon: string
  brandColor: `#${string}`
  defaultPriority: number
  capabilities: ProviderCapabilityV1[]
  /** Core persists only complete library snapshots for providers that opt in. */
  librarySyncMode?: 'host-mirror'
  /** Bounded host call deadline for playback; other capabilities keep core defaults. */
  playbackTimeoutMs?: number
  /** Post-v1 host features this provider needs; see `PROVIDER_HOST_FEATURES_V1`. */
  requiredHostFeatures?: ProviderHostFeatureV1[]
  settings?: ProviderSettingControlV1[]
  permissions?: ProviderPermissionsV1
  build?: ProviderBuildConfigV1
}

export interface ProviderPermissionsV1 {
  /** Exact process environment names passed to this provider at runtime; never packaged. */
  runtimeEnvironment?: string[]
  networkOrigins?: string[]
  externalOrigins?: string[]
  secrets?: string[]
  authCollections?: ProviderAuthCollectionPermissionV1[]
  helpers?: ProviderHelperDeclarationV1[]
}

export interface ProviderAuthCollectionPermissionV1 {
  id: string
  allowedOrigins: string[]
  values: ProviderAuthCollectDescriptorV1[]
}

export type ProviderAuthCollectDescriptorV1 =
  | { name: string; source: 'cookie'; cookieName: string; domain?: string; path?: string }
  | { name: string; source: 'localStorage'; origin: string; key: string }
  | { name: string; source: 'url.searchParam'; origin: string; key: string }
  | ProviderAuthCookieJarDescriptorV1

/**
 * Every cookie of `domains` (and their subdomains) as a Netscape cookie file
 * (`#HttpOnly_` prefix for HttpOnly cookies, integer expiries, 0 for session
 * cookies). Collected only once the window shows `origin` and every
 * `requiredCookies` name exists in those domains. Host feature `auth.browser-session`.
 */
export interface ProviderAuthCookieJarDescriptorV1 {
  name: string
  source: 'cookieJar'
  origin: string
  domains: string[]
  requiredCookies: string[]
}

export interface ProviderHelperDeclarationV1 {
  id: string
  executable: string
  allowedArguments?: string[]
  /** Exact argv shape: one existing cache input, at most one new cache output. */
  argumentTemplate?: Array<string | { cachePath: 'input' | 'output' }>
  /** Best-effort OS scheduling parity for provider-owned background tools. */
  processPriority?: 'below-normal'
}

export interface ProviderBuildConfigV1 {
  steps?: ProviderBuildStepV1[]
  extraResources?: ProviderBuildResourceV1[]
  binaries?: string[]
}

export interface ProviderBuildStepV1 {
  command: string
  args?: string[]
  cwd?: string
  platforms?: Array<'darwin' | 'linux' | 'win32'>
}

export interface ProviderBuildResourceV1 {
  from: string
  to: string
  filter?: string[]
}

export type ProviderSettingControlV1 =
  | ProviderTextSettingV1
  | ProviderSelectSettingV1
  | ProviderToggleSettingV1
  | ProviderActionSettingV1
  | ProviderStatusSettingV1
  | ProviderFormSettingV1

export interface ProviderSettingBaseV1 {
  id: string
  label: string
  description?: string
}

export interface ProviderTextSettingV1 extends ProviderSettingBaseV1 {
  type: 'text'
  key: string
  storage: 'setting' | 'secret'
  placeholder?: string
}

export interface ProviderSelectSettingV1 extends ProviderSettingBaseV1 {
  type: 'select'
  key: string
  storage: 'setting'
  options: Array<{ value: string; label: string }>
  defaultValue?: string
}

export interface ProviderToggleSettingV1 extends ProviderSettingBaseV1 {
  type: 'toggle'
  key: string
  storage: 'setting'
  defaultValue?: boolean
}

export interface ProviderActionSettingV1 extends ProviderSettingBaseV1 {
  type: 'action'
  action: {
    capability: ProviderCapabilityV1
    method: string
    args?: ProviderValueV1[]
  }
  destructive?: boolean
}

export interface ProviderStatusSettingV1 extends ProviderSettingBaseV1 {
  type: 'status'
  statusKey: string
}

/**
 * A core-rendered form (host feature `settings.form`). Submitting invokes
 * `submit.capability`/`submit.method` with one argument,
 * `{ form: <setting id>, values: { <field id>: string } }`. Core never stores
 * the values; the renderer clears them after every submission. `sensitive`
 * fields are masked and must only be persisted by the provider through
 * `host.secrets`.
 */
export interface ProviderFormSettingV1 extends ProviderSettingBaseV1 {
  type: 'form'
  /** Ordered plain-text steps shown above the fields. */
  instructions?: string[]
  fields: ProviderFormFieldV1[]
  submit: {
    label: string
    capability: ProviderCapabilityV1
    method: string
  }
}

export interface ProviderFormFieldV1 {
  id: string
  label: string
  description?: string
  placeholder?: string
  multiline?: boolean
  sensitive?: boolean
  required?: boolean
  /** Maximum accepted characters; the host caps every field at 65,536. */
  maxLength?: number
}
