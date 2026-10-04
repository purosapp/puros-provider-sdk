import type {
  ProviderAlbumV1,
  ProviderArtistV1,
  ProviderPageRequestV1,
  ProviderPageV1,
  ProviderPlaylistFolderV1,
  ProviderPlaylistV1,
  ProviderTrackV1,
} from './catalog'
import type { ProviderValueV1 } from './shared'

export type ProviderLibraryRecordV1 =
  | { type: 'artist'; value: ProviderArtistV1 }
  | { type: 'album'; value: ProviderAlbumV1 }
  | { type: 'track'; value: ProviderTrackV1 }
  | { type: 'playlist'; value: ProviderPlaylistV1 }
  | { type: 'playlistFolder'; value: ProviderPlaylistFolderV1 }
  | { type: 'playlistTrack'; value: ProviderPlaylistTrackV1 }

/** Membership is separate so pages can preserve order and repeated tracks. */
export interface ProviderPlaylistTrackV1 {
  playlistSourceId: string
  trackSourceId: string
  position: number
}

export interface ProviderLibrarySyncRequestV1 {
  cursor?: string | null
  limit?: number
  fullResync?: boolean
}

export interface ProviderLibrarySyncPageV1 {
  records: ProviderLibraryRecordV1[]
  nextCursor: string | null
  complete: boolean
  checkpoint?: ProviderValueV1
}

export interface LibrarySyncCapabilityV1 {
  enumerate(request: ProviderLibrarySyncRequestV1): Promise<ProviderLibrarySyncPageV1>
}

export interface PlaylistsCapabilityV1 {
  list(request?: ProviderPageRequestV1): Promise<ProviderPageV1<ProviderPlaylistV1>>
  get(sourceId: string): Promise<ProviderPlaylistV1>
  getTracks(sourceId: string, request?: ProviderPageRequestV1): Promise<ProviderPageV1<ProviderTrackV1>>
  create?(request: { title: string; description?: string }): Promise<ProviderPlaylistV1>
  update?(request: { sourceId: string; title?: string; description?: string }): Promise<ProviderPlaylistV1>
  remove?(sourceId: string): Promise<void>
  addTracks?(request: { sourceId: string; trackSourceIds: string[] }): Promise<void>
  removeTracks?(request: { sourceId: string; trackSourceIds: string[] }): Promise<void>
}
