import type { ProviderEventV1 } from './events'
import type { ProviderAuthCollectDescriptorV1 } from './manifest'
import type { AudioFormatV1, FormatInfoV1 } from './playback'
import type { ProviderTrackV1 } from './catalog'
import type { ProviderApiVersionV1, ProviderId, ProviderPrimitiveV1, ProviderValueV1 } from './shared'

export interface ProviderHostV1 {
  readonly apiVersion: ProviderApiVersionV1
  readonly providerId: ProviderId
  readonly settings: ProviderSettingsHostV1
  readonly secrets: ProviderSecretsHostV1
  readonly storage: ProviderStorageHostV1
  readonly paths: ProviderPathsHostV1
  readonly cache: ProviderCacheHostV1
  readonly catalog: ProviderCatalogHostV1
  readonly events: ProviderEventsHostV1
  readonly helpers: ProviderHelpersHostV1
  readonly logger: ProviderLoggerV1
  openExternal(url: string): Promise<void>
  openAuthWindow(request: ProviderOpenAuthWindowRequestV1): Promise<ProviderAuthWindowResultV1>
}

export interface ProviderSettingsHostV1 {
  get(key: string): Promise<ProviderPrimitiveV1 | undefined>
  set(key: string, value: ProviderPrimitiveV1): Promise<void>
  delete(key: string): Promise<void>
}

export interface ProviderSecretsHostV1 {
  has(key: string): Promise<boolean>
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface ProviderStorageHostV1 {
  get(key: string): Promise<ProviderValueV1 | undefined>
  set(key: string, value: ProviderValueV1): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}

export interface ProviderPathsHostV1 {
  getCacheRoot(): Promise<string>
  getDataRoot(): Promise<string>
  /** Read-only package/source assets for this provider; never a playback artifact root. */
  getResourceRoot(): Promise<string>
}

export interface ProviderCachedAudioV1 {
  path: string
  format: FormatInfoV1
  /** Source provenance stored with the entry; absent for entries without one. */
  sourceFormat?: FormatInfoV1
  resolvedSourceId: string
  resolvedQuality?: string
}

export interface ProviderCacheHostV1 {
  get(request: { sourceId: string; qualityKey: string; requireLossless?: boolean }): Promise<ProviderCachedAudioV1 | null>
  /** Inspect only a completed file inside this provider's granted cache root. */
  inspectFormat(path: string): Promise<FormatInfoV1 | null>
  /**
   * Whether core plays a completed file of this format directly, so the provider
   * need not convert it. The answer can depend on the Mac (e.g. Ogg Vorbis
   * decoding on newer macOS). Requires the `playback.format-support` host feature.
   */
  canPlayFormat(format: AudioFormatV1): Promise<boolean>
  put(request: {
    sourceId: string
    qualityKey: string
    path: string
    format: FormatInfoV1
    sourceFormat?: FormatInfoV1
    resolvedSourceId?: string
    resolvedQuality?: string
    requireLossless?: boolean
  }): Promise<void>
  trim(): Promise<void>
}

export interface ProviderCatalogHostV1 {
  /** Read only this provider's previously imported canonical track, if present. */
  getStoredTrack(sourceId: string): Promise<ProviderTrackV1 | null>
  /** Core-owned identity seed for provider-private playback candidate recovery. */
  getPlaybackRecoverySeed(sourceId: string): Promise<ProviderPlaybackRecoverySeedV1 | null>
  listTracksNeedingFormat(limit: number): Promise<string[]>
  updateTrackFormat(request: { sourceId: string; format: FormatInfoV1 }): Promise<void>
}

export interface ProviderPlaybackRecoverySeedV1 {
  title: string | null
  artist: string | null
  album: string | null
  isrc: string | null
  durationMs: number | null
  equivalentSourceIds: string[]
}

export interface ProviderEventsHostV1 {
  emit(event: ProviderEventV1): Promise<void>
  /** Coalesce core library/catalog refresh notifications until playback is idle. */
  scheduleLibraryCatalogRefreshWhenIdle(): Promise<void>
}

export interface ProviderLoggerV1 {
  debug(message: string, fields?: Record<string, ProviderValueV1>): Promise<void>
  info(message: string, fields?: Record<string, ProviderValueV1>): Promise<void>
  warn(message: string, fields?: Record<string, ProviderValueV1>): Promise<void>
  error(message: string, fields?: Record<string, ProviderValueV1>): Promise<void>
}

export interface ProviderOpenAuthWindowRequestV1 {
  url: string
  /**
   * `persist:puros-provider-<id>[-suffix]` keeps the sign-in on disk between
   * windows. Without `persist:` (host feature `auth.browser-session`) the
   * partition lives in memory and the host wipes it before the window opens and
   * after it closes, so nothing of the sign-in outlives the returned values.
   */
  partition: string
  allowedOrigins: string[]
  collect: ProviderAuthCollectDescriptorV1[]
  /**
   * Host feature `auth.browser-session`. `browser`: Google Chrome of the
   * embedded Chromium's version — its user agent without the app and Electron
   * product tokens, and matching client hints (`Sec-CH-UA`,
   * `navigator.userAgentData`) that include the "Google Chrome" brand. `firefox`: a
   * Firefox user agent with Chromium's user-agent client hints switched off
   * (no `Sec-CH-UA` headers, no `navigator.userAgentData` brands), for sign-in
   * pages that reject embedded Chromium.
   */
  userAgent?: 'browser' | 'firefox'
}

export interface ProviderAuthWindowResultV1 {
  completed: boolean
  values: Record<string, string>
}

export interface ProviderHelpersHostV1 {
  spawn(request: ProviderHelperSpawnRequestV1): Promise<ProviderHelperHandleV1>
  write(request: { handleId: string; data: string | Uint8Array }): Promise<void>
  closeStdin(handleId: string): Promise<void>
  /** Private to the provider runtime; helper output must never be a renderer event. */
  read(handleId: string): Promise<ProviderHelperOutputV1>
  terminate(handleId: string): Promise<void>
}

export type ProviderHelperOutputV1 =
  | { type: 'stdout' | 'stderr'; data: Uint8Array }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; message: string }

export interface ProviderHelperSpawnRequestV1 {
  binaryId: string
  args?: string[]
}

export interface ProviderHelperHandleV1 {
  handleId: string
}
