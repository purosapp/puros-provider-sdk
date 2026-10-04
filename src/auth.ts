export interface ProviderAuthStatusV1 {
  authenticated: boolean
  accountLabel?: string | null
  expiresAt?: number | null
  message?: string | null
}

export interface ProviderAuthStartResultV1 {
  status: ProviderAuthStatusV1
  userCode?: string
  verificationUrl?: string
  expiresAt?: number
}

/**
 * Optional `login` argument. Manifest actions pass their declared `args`; a
 * `form` setting (host feature `settings.form`) passes the submitted field
 * values once. Form values may be credentials: never echo them in results,
 * errors, events, or logs.
 */
export interface ProviderAuthLoginRequestV1 {
  /** The submitting form's setting ID. */
  form?: string
  /** Field ID → submitted text. */
  values?: Record<string, string>
  [key: string]: unknown
}

export interface AuthCapabilityV1 {
  getStatus(): Promise<ProviderAuthStatusV1>
  login(request?: ProviderAuthLoginRequestV1): Promise<ProviderAuthStartResultV1>
  logout(): Promise<void>
  cancelLogin?(): Promise<void>
}
