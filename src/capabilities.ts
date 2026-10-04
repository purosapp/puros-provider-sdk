import type { AuthCapabilityV1 } from './auth'
import type { CatalogEntitiesCapabilityV1, CatalogHomeCapabilityV1, CatalogSearchCapabilityV1 } from './catalog'
import type { LibrarySyncCapabilityV1, PlaylistsCapabilityV1 } from './library'
import type { MetadataArtworkCapabilityV1, MetadataBioCapabilityV1, MetadataCreditsCapabilityV1 } from './metadata'
import type {
  PlaybackPrefetchCapabilityV1,
  PlaybackProgressiveCapabilityV1,
  PlaybackResolveCapabilityV1,
  QualityTiersCapabilityV1,
} from './playback'

export const PROVIDER_CAPABILITIES_V1 = [
  'auth',
  'catalog.search',
  'catalog.entities',
  'catalog.home',
  'library.sync',
  'playlists',
  'playback.resolve',
  'playback.prefetch',
  'playback.progressive',
  'quality.tiers',
  'metadata.artwork',
  'metadata.bio',
  'metadata.credits',
] as const

export type ProviderCapabilityV1 = typeof PROVIDER_CAPABILITIES_V1[number]

export interface ProviderCapabilityImplementationsV1 {
  auth?: AuthCapabilityV1
  'catalog.search'?: CatalogSearchCapabilityV1
  'catalog.entities'?: CatalogEntitiesCapabilityV1
  'catalog.home'?: CatalogHomeCapabilityV1
  'library.sync'?: LibrarySyncCapabilityV1
  playlists?: PlaylistsCapabilityV1
  'playback.resolve'?: PlaybackResolveCapabilityV1
  'playback.prefetch'?: PlaybackPrefetchCapabilityV1
  'playback.progressive'?: PlaybackProgressiveCapabilityV1
  'quality.tiers'?: QualityTiersCapabilityV1
  'metadata.artwork'?: MetadataArtworkCapabilityV1
  'metadata.bio'?: MetadataBioCapabilityV1
  'metadata.credits'?: MetadataCreditsCapabilityV1
}
