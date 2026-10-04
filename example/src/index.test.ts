import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderHostV1, ProviderValueV1 } from 'puros-provider-sdk'
import plugin from './index'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function createHost(cacheRoot: string): ProviderHostV1 {
  const settings = new Map<string, string | number | boolean | null>()
  const storage = new Map<string, ProviderValueV1>()
  return {
    apiVersion: 1,
    providerId: 'example',
    settings: {
      async get(key) { return settings.get(key) },
      async set(key, value) { settings.set(key, value) },
      async delete(key) { settings.delete(key) },
    },
    secrets: {
      async has() { return false },
      async get() { return undefined },
      async set() {},
      async delete() {},
    },
    storage: {
      async get(key) { return storage.get(key) },
      async set(key, value) { storage.set(key, value) },
      async delete(key) { storage.delete(key) },
      async list(prefix = '') { return [...storage.keys()].filter((key) => key.startsWith(prefix)) },
    },
    paths: {
      async getCacheRoot() { return cacheRoot },
      async getDataRoot() { return cacheRoot },
      async getResourceRoot() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') },
    },
    events: { async emit() {}, async scheduleLibraryCatalogRefreshWhenIdle() {} },
    helpers: {
      async spawn() { throw new Error('No helpers declared') },
      async write() { throw new Error('No helpers declared') },
      async read() { throw new Error('No helpers declared') },
      async closeStdin() { throw new Error('No helpers declared') },
      async terminate() { throw new Error('No helpers declared') },
    },
    logger: {
      async debug() {},
      async info() {},
      async warn() {},
      async error() {},
    },
    async openExternal() { throw new Error('No external origins declared') },
    async openAuthWindow() { throw new Error('No auth collection declared') },
    cache: {
      async get() { return null },
      async inspectFormat() { return null },
      async canPlayFormat() { return true },
      async put() {},
      async trim() {},
    },
    catalog: {
      async getStoredTrack() { return null },
      async getPlaybackRecoverySeed() { return null },
      async listTracksNeedingFormat() { return [] },
      async updateTrackFormat() {},
    },
  }
}

describe('example provider contract', () => {
  it('implements exactly the capabilities declared by its manifest', async () => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'puros-example-provider-'))
    temporaryRoots.push(cacheRoot)
    const runtime = await plugin.activate(createHost(cacheRoot))
    expect(Object.keys(runtime.capabilities).sort()).toEqual([...plugin.manifest.capabilities].sort())
    expect((await runtime.getStatus()).state).toBe('ready')

    const search = await runtime.capabilities['catalog.search']!.search({ query: 'contract' })
    expect(search.tracks[0]?.sourceId).toBe('example-track')

    const artifact = await runtime.capabilities['playback.resolve']!.resolve({
      sourceId: 'example-track',
      intent: 'playback',
    })
    expect(artifact.lifecycle).toBe('complete')
    expect(path.dirname(artifact.path)).toBe(cacheRoot)
    expect(fs.statSync(artifact.path).size).toBeGreaterThan(1_000)

    await runtime.deactivate()
    expect((await runtime.getStatus()).state).toBe('inactive')
  })
})
