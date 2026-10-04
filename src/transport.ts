import type { ProviderCapabilityV1 } from './capabilities'
import type { ProviderEventV1 } from './events'
import type { ProviderResultV1 } from './errors'
import type { ProviderManifestV1 } from './manifest'
import type { ProviderStatusV1 } from './plugin'
import type { ProviderApiVersionV1, ProviderId, ProviderPrimitiveV1, ProviderValueV1 } from './shared'

/** The process wire also carries helper byte chunks; capability DTOs remain ProviderValueV1. */
export type ProviderWireValueV1 =
  | ProviderPrimitiveV1
  | undefined
  | Uint8Array
  | ProviderWireValueV1[]
  | { [key: string]: ProviderWireValueV1 }

export type ProviderRuntimeRequestV1 =
  | { type: 'runtime.request'; apiVersion: ProviderApiVersionV1; requestId: string; providerId: ProviderId; action: 'activate' }
  | { type: 'runtime.request'; apiVersion: ProviderApiVersionV1; requestId: string; providerId: ProviderId; action: 'getStatus' }
  | { type: 'runtime.request'; apiVersion: ProviderApiVersionV1; requestId: string; providerId: ProviderId; action: 'invoke'; capability: ProviderCapabilityV1; method: string; args: ProviderValueV1[] }
  | { type: 'runtime.request'; apiVersion: ProviderApiVersionV1; requestId: string; providerId: ProviderId; action: 'cancelSession'; sessionId: string }
  | { type: 'runtime.request'; apiVersion: ProviderApiVersionV1; requestId: string; providerId: ProviderId; action: 'deactivate' }

export interface ProviderHostRequestV1 {
  type: 'host.request'
  apiVersion: ProviderApiVersionV1
  requestId: string
  namespace: 'settings' | 'secrets' | 'storage' | 'paths' | 'cache' | 'catalog' | 'events' | 'helpers' | 'logger' | 'host'
  method: string
  args: ProviderWireValueV1[]
}

export interface ProviderRpcResponseV1 {
  type: 'rpc.response'
  apiVersion: ProviderApiVersionV1
  requestId: string
  result: ProviderResultV1<ProviderWireValueV1 | undefined>
}

export interface ProviderRuntimeEventV1 {
  type: 'provider.event'
  apiVersion: ProviderApiVersionV1
  envelope: ProviderEventEnvelopeV1
}

export type ProviderWireMessageV1 =
  | ProviderRuntimeRequestV1
  | ProviderHostRequestV1
  | ProviderRpcResponseV1
  | ProviderRuntimeEventV1

export interface ProviderInvokeRequestV1 {
  apiVersion: ProviderApiVersionV1
  requestId: string
  providerId: ProviderId
  capability: ProviderCapabilityV1
  method: string
  args: ProviderValueV1[]
}

export interface ProviderInvokeResponseV1 {
  apiVersion: ProviderApiVersionV1
  requestId: string
  result: ProviderResultV1<ProviderValueV1 | undefined>
}

export interface ProviderEventEnvelopeV1 {
  apiVersion: ProviderApiVersionV1
  providerId: ProviderId
  sequence: number
  event: ProviderEventV1
}

export interface ProviderDescriptorV1 {
  manifest: ProviderManifestV1
  status: ProviderStatusV1
  iconUrl?: string
}

// Future design marker only. It is intentionally not exposed by ProviderHostV1.
export interface PcmSinkVNextSketch {
  open(format: {
    sampleRate: number
    channels: number
    sampleType: 's16' | 's24' | 's32' | 'f32'
    interleaved: boolean
    littleEndian: boolean
  }): Promise<{ handleId: string }>
  write(handleId: string, chunk: ArrayBuffer): Promise<{ acceptedBytes: number }>
  end(handleId: string): Promise<void>
  abort(handleId: string): Promise<void>
}
