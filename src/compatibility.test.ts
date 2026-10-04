import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  API_VERSION,
  PROVIDER_CAPABILITIES_V1,
  isProviderApiCompatible,
  isValidProviderId,
} from './index'

describe('Provider API v1 compatibility', () => {
  it('accepts dynamic provider IDs and reserves local for core', () => {
    expect(isValidProviderId('example')).toBe(true)
    expect(isValidProviderId('service-2')).toBe(true)
    expect(isValidProviderId('local')).toBe(false)
    expect(isValidProviderId('m3u')).toBe(false)
    expect(isValidProviderId('_example')).toBe(false)
    expect(isValidProviderId('A')).toBe(false)
  })

  it('requires the exact public API version', () => {
    expect(isProviderApiCompatible({ apiVersion: API_VERSION })).toBe(true)
    expect(isProviderApiCompatible({ apiVersion: 2 })).toBe(false)
  })

  it('keeps the JSON schema capability enum aligned with TypeScript', () => {
    const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'provider-manifest.schema.json')
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
      $defs: { capability: { enum: string[] } }
    }
    expect(schema.$defs.capability.enum).toEqual(PROVIDER_CAPABILITIES_V1)
  })
})
