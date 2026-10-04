export type AudioFormatV1 =
  | 'FLAC'
  | 'FLAC_HIRES'
  | 'MQA'
  | 'DSD'
  | 'ALAC'
  | 'AIFF'
  | 'WAV'
  | 'MP3'
  | 'AAC'
  | 'VORBIS'
  /** Opus (Ogg container); lossy, decoded at 48 kHz. Requires `audio-format.opus`. */
  | 'OPUS'

export const PROVIDER_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export interface FormatInfoV1 {
  format: AudioFormatV1
  sampleRate: number
  bitDepth: number
  bitrate: number
  channels: number
  isLossless: boolean
  isHiRes: boolean
  isMqa: boolean
  isDsd: boolean
  dsdRate?: number
}

export interface PlaybackArtifactV1 {
  path: string
  lifecycle: 'complete' | 'growing'
  /** The prepared file itself; core negotiates output from this. */
  format: FormatInfoV1
  /**
   * What the service delivered when it differs from the prepared file, e.g. a
   * lossy Vorbis source decoded into a FLAC artifact. Quality labels and
   * lossless checks use this; absent means `format` describes the source too.
   */
  sourceFormat?: FormatInfoV1
  sessionId?: string
}

export interface PlaybackResolveRequestV1 {
  sourceId: string
  /** Optional caller-issued handle for progress and in-flight cancellation. */
  sessionId?: string
  fallbackSourceIds?: string[]
  qualityTierId?: string | null
  intent: 'playback' | 'prefetch'
}

export interface PlaybackResolveCapabilityV1 {
  resolve(request: PlaybackResolveRequestV1): Promise<PlaybackArtifactV1>
}

export interface PlaybackPrefetchCapabilityV1 {
  prefetch(request: Omit<PlaybackResolveRequestV1, 'intent'>): Promise<PlaybackArtifactV1 | null>
}

export interface PlaybackProgressiveCapabilityV1 {
  markPlaybackStarted(request: { sessionId: string }): Promise<void>
  cancel(request: { sessionId: string }): Promise<void>
}

export interface QualityTierV1 {
  id: string
  label: string
  description?: string
  rank: number
  lossless?: boolean
  hiRes?: boolean
}

export interface QualityTiersCapabilityV1 {
  list(): Promise<QualityTierV1[]>
  getSelected(): Promise<string | null>
  select(request: { tierId: string }): Promise<void>
}
