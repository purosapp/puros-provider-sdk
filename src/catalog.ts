import type { FormatInfoV1 } from './playback'

export type ProviderEntityTypeV1 = 'artist' | 'album' | 'track' | 'playlist'
export type ProviderReleaseTypeV1 = 'album' | 'ep' | 'single' | 'compilation' | 'live' | 'other'
export type ProviderCreditRoleV1 =
  | 'primary'
  | 'main'
  | 'featured'
  | 'composer'
  | 'producer'
  | 'conductor'
  | 'performer'
  | 'related'
  | 'other'

export interface ProviderEntityRefV1 {
  entityType: ProviderEntityTypeV1
  sourceId: string
}

export interface ProviderArtistCreditV1 {
  artistSourceId?: string | null
  artistName: string
  role: ProviderCreditRoleV1
  joinPhrase?: string | null
  position: number
}

export interface ProviderCreditV1 {
  name: string
  role: ProviderCreditRoleV1
  artistSourceId?: string | null
  joinPhrase?: string | null
  position?: number
}

export interface ProviderArtistV1 {
  sourceId: string
  name: string
  normalizedName?: string | null
  artworkUrl?: string | null
  bio?: string | null
  bioUrl?: string | null
  genres?: string[]
  providerUrl?: string | null
  albumCount?: number | null
  trackCount?: number | null
  inLibrary?: boolean
}

export interface ProviderAlbumV1 {
  sourceId: string
  title: string
  normalizedTitle?: string | null
  upc?: string | null
  year?: number | null
  releaseType?: ProviderReleaseTypeV1 | null
  artworkUrl?: string | null
  primaryArtistSourceId?: string | null
  primaryArtistName?: string | null
  artists?: ProviderArtistCreditV1[]
  genres?: string[]
  totalTracks?: number | null
  totalDiscs?: number | null
  providerUrl?: string | null
  inLibrary?: boolean
}

export interface ProviderTrackV1 {
  sourceId: string
  title: string
  normalizedTitle?: string | null
  isrc?: string | null
  upc?: string | null
  durationMs: number
  trackNumber?: number | null
  discNumber?: number | null
  albumSourceId?: string | null
  albumTitle?: string | null
  primaryArtistSourceId?: string | null
  primaryArtistName?: string | null
  artists?: ProviderArtistCreditV1[]
  genres?: string[]
  artworkUrl?: string | null
  providerUrl?: string | null
  inLibrary?: boolean
  format?: FormatInfoV1 | null
}

export interface ProviderPlaylistV1 {
  sourceId: string
  title: string
  description?: string | null
  artworkUrl?: string | null
  trackCount?: number | null
  providerUrl?: string | null
  editable?: boolean
  folderSourceId?: string | null
  folderPosition?: number | null
  collectionRef?: { type: 'playlist' | 'mix' | 'station'; sourceId: string }
}

export interface ProviderPlaylistFolderV1 {
  sourceId: string
  name: string
  parentSourceId?: string | null
  position?: number | null
}

export interface ProviderArtistBundleV1 {
  artist: ProviderArtistV1
  releases: ProviderAlbumV1[]
  playlists: ProviderPlaylistV1[]
  topTracks: ProviderTrackV1[]
  relatedArtists: ProviderArtistV1[]
}

export interface ProviderAlbumBundleV1 {
  album: ProviderAlbumV1
  tracks: ProviderTrackV1[]
}

export interface ProviderSearchRequestV1 {
  query: string
  limit?: number
  cursor?: string | null
  types?: ProviderEntityTypeV1[]
}

export interface ProviderSearchResultsV1 {
  artists: ProviderArtistV1[]
  albums: ProviderAlbumV1[]
  tracks: ProviderTrackV1[]
  playlists: ProviderPlaylistV1[]
  nextCursor?: string | null
}

export interface ProviderPageRequestV1 {
  cursor?: string | null
  limit?: number
}

export interface ProviderPageV1<T> {
  items: T[]
  nextCursor: string | null
}

export interface CatalogSearchCapabilityV1 {
  search(request: ProviderSearchRequestV1): Promise<ProviderSearchResultsV1>
}

export interface CatalogEntitiesCapabilityV1 {
  getArtist(sourceId: string): Promise<ProviderArtistV1>
  /** Optional batch of provider-official artist genres; absent providers use getArtist fallback. */
  getArtistGenres?(sourceIds: string[]): Promise<Record<string, string[]>>
  getArtistBundle(sourceId: string, request?: ProviderPageRequestV1): Promise<ProviderArtistBundleV1>
  getAlbum(sourceId: string): Promise<ProviderAlbumV1>
  getAlbumBundle(sourceId: string, request?: ProviderPageRequestV1): Promise<ProviderAlbumBundleV1>
  getTrack(sourceId: string): Promise<ProviderTrackV1>
}

export type ProviderHomeShelfKindV1 = 'albums' | 'tracks' | 'playlists' | 'artists' | 'mixed'

export interface ProviderHomeShelfV1 {
  id: string
  title: string
  kind: ProviderHomeShelfKindV1
  items: Array<ProviderArtistV1 | ProviderAlbumV1 | ProviderTrackV1 | ProviderPlaylistV1>
  collectionRef?: { type: 'playlist' | 'mix' | 'station'; sourceId: string }
}

export interface ProviderHomeCollectionV1 {
  title: string
  subtitle?: string | null
  artworkUrl?: string | null
  tracks: ProviderTrackV1[]
}

export interface CatalogHomeCapabilityV1 {
  getShelves(request?: ProviderPageRequestV1): Promise<ProviderPageV1<ProviderHomeShelfV1>>
  getCollection(request: {
    type: 'playlist' | 'mix' | 'station'
    sourceId: string
    cursor?: string | null
    limit?: number
  }): Promise<ProviderHomeCollectionV1>
}
