import type { ProviderCapabilityImplementationsV1 } from './capabilities'
import type { ProviderErrorV1 } from './errors'
import type { ProviderHostV1 } from './host'
import type { ProviderManifestV1 } from './manifest'
import type { ProviderApiVersionV1, ProviderPrimitiveV1 } from './shared'

export type ProviderLifecycleStateV1 = 'inactive' | 'activating' | 'ready' | 'degraded' | 'error'

export interface ProviderStatusV1 {
  state: ProviderLifecycleStateV1
  authenticated?: boolean
  message?: string
  updatedAt: number
  values?: Record<string, ProviderPrimitiveV1>
  error?: ProviderErrorV1
}

export interface ProviderPluginV1 {
  readonly apiVersion: ProviderApiVersionV1
  readonly manifest: ProviderManifestV1
  activate(host: ProviderHostV1): Promise<ProviderRuntimeV1>
}

export interface ProviderRuntimeV1 {
  readonly capabilities: ProviderCapabilityImplementationsV1
  getStatus(): Promise<ProviderStatusV1>
  /** Cancel a host-visible playback session; returns false when no such session is active. */
  cancelSession?(sessionId: string): Promise<boolean>
  deactivate(): Promise<void>
}
