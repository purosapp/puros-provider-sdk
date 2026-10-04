import type { ProviderAuthStatusV1 } from './auth'
import type { ProviderEntityTypeV1 } from './catalog'
import type { ProviderErrorV1 } from './errors'
import type { FormatInfoV1 } from './playback'
import type { ProviderStatusV1 } from './plugin'

export type ProviderEventV1 =
  | { type: 'status.changed'; status: ProviderStatusV1 }
  | { type: 'auth.changed'; status: ProviderAuthStatusV1 }
  | { type: 'catalog.changed'; entityTypes?: ProviderEntityTypeV1[] }
  | { type: 'library.sync.progress'; processed: number; total?: number; label?: string }
  | { type: 'playback.session'; session: ProviderPlaybackSessionV1 }
  | { type: 'playback.progress'; progress: ProviderPlaybackProgressV1 }
  | { type: 'warning'; code: string; message: string; retryable?: boolean }

export type ProviderPlaybackSessionStateV1 =
  | 'created'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface ProviderPlaybackSessionV1 {
  sessionId: string
  sourceId: string
  state: ProviderPlaybackSessionStateV1
  artifactPath?: string
  /**
   * With `completed`: the finished artifact's format when it is more precise
   * than the one first returned (e.g. the average bitrate of a lossless file).
   * Core updates only the displayed quality; the open stream is unchanged.
   */
  format?: FormatInfoV1
  /** With `completed`: the delivered source format when the artifact is a conversion. */
  sourceFormat?: FormatInfoV1
  playbackStarted: boolean
  revision: number
  error?: ProviderErrorV1
}

export interface ProviderPlaybackProgressV1 {
  sessionId: string
  sourceId: string
  state: ProviderPlaybackSessionStateV1
  bytesCompleted?: number
  bytesTotal?: number | null
  itemsCompleted?: number
  itemsTotal?: number | null
  percent?: number | null
  bytesPerSecond?: number | null
  estimatedRemainingMs?: number | null
  playbackStarted: boolean
  revision: number
}
