import type { ProviderCreditV1, ProviderEntityRefV1 } from './catalog'

export interface ProviderArtworkResultV1 {
  url: string
  width?: number
  height?: number
  mimeType?: string
  sourceUrl?: string
  expiresAt?: number | null
}

export interface ProviderBioResultV1 {
  text: string
  sourceUrl?: string
  genres?: string[]
  expiresAt?: number | null
}

export interface MetadataArtworkCapabilityV1 {
  getArtwork(ref: ProviderEntityRefV1): Promise<ProviderArtworkResultV1 | null>
  /** Optional, local-only URL variant for an existing artwork URL; no fetch required. */
  getDisplayArtworkUrl?(url: string): Promise<string | null>
}

export interface MetadataBioCapabilityV1 {
  getBio(ref: ProviderEntityRefV1): Promise<ProviderBioResultV1 | null>
}

export interface MetadataCreditsCapabilityV1 {
  getCredits(ref: ProviderEntityRefV1): Promise<ProviderCreditV1[]>
  /** Optional richer track credits/label data for a core-rendered details panel. */
  getTrackDetails?(sourceId: string): Promise<ProviderTrackDetailsV1 | null>
}

export interface ProviderTrackDetailsV1 {
  sourceId: string
  providerUrl?: string | null
  albumSourceId?: string | null
  albumTitle?: string | null
  releaseDate?: string | null
  label?: string | null
  copyright?: string | null
  isrc?: string | null
  upc?: string | null
  roles: Array<{ role: string; contributors: string[] }>
}
