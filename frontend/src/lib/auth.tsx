import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import {
  clearSupabaseToken,
  getSupabase,
  initSupabase,
  isProviderDisabledError,
  setProvider as setProviderKind,
  supabaseErrorMessage,
} from './supabase'
import type { AuthProviderKind } from './supabase'
import type { AuthConfig, AuthResponse, Company, MeResponse, User } from '../types'
import { normalizeStatus, setupRequired as computeSetupRequired } from './onboarding'
import type { SetupStatus } from './onboarding'

export const PENDING_COMPANY_KEY = 'flaire:pending-company'
/** Email of the last sign-up, so the callback page can offer "resend" when a confirmation link has expired. */
export const PENDING_EMAIL_KEY = 'flaire:pending-email'

export type RegisterResult = { status: 'signed_in'; needs_onboarding: boolean; needs_setup: boolean } | { status: 'confirm_email'; email: string }

export interface LoginResult {
  needs_onboarding: boolean
  /** True when the person still has to go through /setup (no company, no 2FA, or the wizard was never finished). */
  needs_setup: boolean
}

export interface ForgotResult {
  ok: boolean
  message: string
  /** Only returned by a development backend (builtin mode), so the link can be opened without email. */
  reset_link?: string
}

/** /auth/me with the optional platform-admin flag the newer backend adds. */
type MeData = MeResponse & { user: User & { is_platform_admin?: boolean } }

/** /auth/config with the optional google flag. When the field is missing the Google button stays visible. */
type ConfigData = AuthConfig & { google_enabled?: boolean }

interface AuthState {
  user: (User & { is_platform_admin?: boolean }) | null
  company: Company | null
  /** Signed in but no company yet. */
  needsOnboarding: boolean
  /** Latest GET /onboarding/status (null before it loaded or when there is no company). */
  onboarding: SetupStatus | null
  /** The person must finish /setup before using the app. */
  setupRequired: boolean
  provider: AuthProviderKind
  /** False only when /auth/config explicitly says Google sign-in is off. */
  googleEnabled: boolean
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, code?: string) => Promise<LoginResult>
  register: (input: {
    company_name: string
    email: string
    password: string
    full_name: string
    returnTo?: string
  }) => Promise<RegisterResult>
  forgot: (email: string) => Promise<ForgotResult>
  /** Supabase mode: send the sign-up confirmation email again. */
  resendConfirmation: (email: string) => Promise<void>
  /** Supabase mode only: start the Google OAuth redirect. Throws a ProviderDisabledError when Google is not enabled. */
  signInWithGoogle: (returnTo?: string) => Promise<void>
  logout: () => Promise<void>
  /** Re-fetch /auth/me and /onboarding/status (used after company settings, onboarding or kill switch change). */
  refresh: () => Promise<void>
  /** Re-fetch only /onboarding/status. Returns the fresh status. */
  refreshOnboarding: () => Promise<SetupStatus | null>
  /** Replace the company in context without a network call. */
  setCompany: (c: Company) => void
  /** Builtin mode: store a token and session returned by another endpoint (invite accept). */
  adoptSession: (data: AuthResponse) => void
}

export class ProviderDisabledError extends Error {
  constructor() {
    super('Google sign-in is not enabled yet')
    this.name = 'ProviderDisabledError'
  }
}

const AuthContext = createContext<AuthState | null>(null)

/** Where Supabase sends the browser back after email confirmation, magic link, OAuth and password recovery. */
export function callbackUrl(params?: Record<string, string | undefined>): string {
  const url = new URL('/auth/callback', window.location.origin)
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v)
  return url.toString()
}

async function fetchOnboarding(user: User | null): Promise<SetupStatus | null> {
  try {
    const { data } = await api.get('/onboarding/status')
    return normalizeStatus(data, user)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState['user']>(null)
  const [company, setCompanyState] = useState<Company | null>(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [onboarding, setOnboarding] = useState<SetupStatus | null>(null)
  const [provider, setProvider] = useState<AuthProviderKind>('builtin')
  const [googleEnabled, setGoogleEnabled] = useState(true)
  const [loading, setLoading] = useState<boolean>(true)
  const userRef = useRef<User | null>(null)
  userRef.current = user

  const clear = useCallback(() => {
    setUser(null)
    setCompanyState(null)
    setNeedsOnboarding(false)
    setOnboarding(null)
  }, [])

  /** Applies /auth/me and loads the setup status when there is a company. Returns whether /setup is still needed. */
  const applyMe = useCallback(async (data: MeData): Promise<boolean> => {
    setUser(data.user)
    setCompanyState(data.company)
    const noCompany = !!data.needs_onboarding || !data.company
    setNeedsOnboarding(noCompany)
    const status = data.company ? await fetchOnboarding(data.user) : null
    setOnboarding(status)
    return computeSetupRequired(status, data.user, !noCompany)
  }, [])

  const applyAuth = useCallback((data: AuthResponse) => {
    setToken(data.access_token)
    setUser(data.user)
    setCompanyState(data.company)
    setNeedsOnboarding(!data.company)
    setOnboarding(null)
  }, [])

  const adoptSession = useCallback(
    (data: AuthResponse) => {
      applyAuth(data)
      if (data.company) void fetchOnboarding(data.user).then(setOnboarding)
    },
    [applyAuth],
  )

  const refresh = useCallback(async () => {
    const sb = getSupabase()
    if (sb) {
      const { data } = await sb.auth.getSession()
      if (!data.session) {
        clear()
        return
      }
    } else if (!getToken()) {
      clear()
      return
    }
    const { data } = await api.get<MeData>('/auth/me')
    await applyMe(data)
  }, [applyMe, clear])

  const refreshOnboarding = useCallback(async () => {
    const status = await fetchOnboarding(userRef.current)
    setOnboarding(status)
    return status
  }, [])

  // Boot: find out which sign-in system to use, then restore any existing session.
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    const boot = async () => {
      let config: ConfigData = { provider: 'builtin' }
      try {
        const { data } = await api.get<ConfigData>('/auth/config', { timeout: 15_000 })
        config = data
      } catch {
        // Backend unreachable or old backend without /auth/config: fall back to builtin auth.
      }
      if (cancelled) return
      setGoogleEnabled(config.google_enabled !== false)

      if (config.provider === 'supabase' && config.supabase_url && config.supabase_anon_key) {
        const sb = initSupabase(config.supabase_url, config.supabase_anon_key)
        setProvider('supabase')
        const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
          // Defer: calling the API (which reads the session) inside the callback can deadlock the auth client.
          window.setTimeout(() => {
            if (cancelled) return
            if (event === 'SIGNED_OUT' || !session) {
              clear()
              return
            }
            if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !userRef.current) {
              refresh().catch(() => clear())
            }
          }, 0)
        })
        unsubscribe = () => sub.subscription.unsubscribe()
        try {
          const { data } = await sb.auth.getSession()
          if (data.session) await refresh()
          else clear()
        } catch {
          clear()
        }
      } else {
        setProviderKind('builtin')
        setProvider('builtin')
        if (getToken()) {
          try {
            await refresh()
          } catch {
            setToken(null)
            clear()
          }
        }
      }
      if (!cancelled) setLoading(false)
    }

    void boot()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [refresh, clear])

  const login = useCallback(
    async (email: string, password: string, code?: string): Promise<LoginResult> => {
      const sb = getSupabase()
      if (sb) {
        // Flaire's 2FA code is not part of Supabase sign-in; `code` is ignored here.
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new Error(supabaseErrorMessage(error))
        const { data } = await api.get<MeData>('/auth/me')
        const needs_setup = await applyMe(data)
        return { needs_onboarding: !!data.needs_onboarding || !data.company, needs_setup }
      }
      const { data } = await api.post<AuthResponse>('/auth/login', code ? { email, password, code } : { email, password })
      applyAuth(data)
      const status = data.company ? await fetchOnboarding(data.user) : null
      setOnboarding(status)
      return { needs_onboarding: !data.company, needs_setup: computeSetupRequired(status, data.user, !!data.company) }
    },
    [applyAuth, applyMe],
  )

  const register = useCallback(
    async (input: { company_name: string; email: string; password: string; full_name: string; returnTo?: string }): Promise<RegisterResult> => {
      const sb = getSupabase()
      if (sb) {
        try {
          localStorage.setItem(PENDING_COMPANY_KEY, input.company_name)
          localStorage.setItem(PENDING_EMAIL_KEY, input.email)
        } catch {
          // storage unavailable, the setup page will just ask
        }
        const { data, error } = await sb.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: { full_name: input.full_name },
            emailRedirectTo: callbackUrl({ type: 'signup', returnTo: input.returnTo }),
          },
        })
        if (error) throw new Error(supabaseErrorMessage(error))
        if (data.session) {
          const me = await api.get<MeData>('/auth/me')
          const needs_setup = await applyMe(me.data)
          return { status: 'signed_in', needs_onboarding: !!me.data.needs_onboarding || !me.data.company, needs_setup }
        }
        return { status: 'confirm_email', email: input.email }
      }
      const { data } = await api.post<AuthResponse>('/auth/register', {
        company_name: input.company_name,
        email: input.email,
        password: input.password,
        full_name: input.full_name,
      })
      applyAuth(data)
      return { status: 'signed_in', needs_onboarding: !data.company, needs_setup: true }
    },
    [applyAuth, applyMe],
  )

  const forgot = useCallback(async (email: string): Promise<ForgotResult> => {
    const sb = getSupabase()
    if (sb) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl({ type: 'recovery' }) })
      if (error) throw new Error(supabaseErrorMessage(error))
      return { ok: true, message: `If an account exists for ${email}, a reset link is on its way.` }
    }
    const { data } = await api.post<ForgotResult>('/auth/forgot', { email })
    return data
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const sb = getSupabase()
    if (!sb) throw new Error('Email confirmation is only used with Supabase auth.')
    const { error } = await sb.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: callbackUrl({ type: 'signup' }) },
    })
    if (error) throw new Error(supabaseErrorMessage(error))
  }, [])

  const signInWithGoogle = useCallback(async (returnTo?: string) => {
    const sb = getSupabase()
    if (!sb) throw new Error('Google sign-in is only available with Supabase auth.')
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl({ returnTo }) },
    })
    if (error) {
      if (isProviderDisabledError(error)) throw new ProviderDisabledError()
      throw new Error(supabaseErrorMessage(error))
    }
  }, [])

  const logout = useCallback(async () => {
    const sb = getSupabase()
    clear()
    if (sb) {
      clearSupabaseToken()
      try {
        await sb.auth.signOut()
      } catch {
        // already signed out
      }
    } else {
      setToken(null)
    }
  }, [clear])

  const setupRequired = useMemo(
    () => !!user && computeSetupRequired(onboarding, user, !needsOnboarding && !!company),
    [user, onboarding, needsOnboarding, company],
  )

  const value = useMemo<AuthState>(
    () => ({
      user,
      company,
      needsOnboarding,
      onboarding,
      setupRequired,
      provider,
      googleEnabled,
      loading,
      isAuthenticated: !!user,
      login,
      register,
      forgot,
      resendConfirmation,
      signInWithGoogle,
      logout,
      refresh,
      refreshOnboarding,
      setCompany: (c: Company) => {
        setCompanyState(c)
        setNeedsOnboarding(false)
      },
      adoptSession,
    }),
    [
      user,
      company,
      needsOnboarding,
      onboarding,
      setupRequired,
      provider,
      googleEnabled,
      loading,
      login,
      register,
      forgot,
      resendConfirmation,
      signInWithGoogle,
      logout,
      refresh,
      refreshOnboarding,
      adoptSession,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
