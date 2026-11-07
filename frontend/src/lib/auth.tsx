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

export const PENDING_COMPANY_KEY = 'flaire:pending-company'

export type RegisterResult = { status: 'signed_in'; needs_onboarding: boolean } | { status: 'confirm_email'; email: string }

export interface ForgotResult {
  ok: boolean
  message: string
  /** Only returned by a development backend (builtin mode), so the link can be opened without email. */
  reset_link?: string
}

interface AuthState {
  user: User | null
  company: Company | null
  /** Signed in but no company yet: every protected page sends them to /welcome. */
  needsOnboarding: boolean
  provider: AuthProviderKind
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, code?: string) => Promise<{ needs_onboarding: boolean }>
  register: (input: {
    company_name: string
    email: string
    password: string
    full_name: string
  }) => Promise<RegisterResult>
  forgot: (email: string) => Promise<ForgotResult>
  /** Supabase mode only: start the Google OAuth redirect. Throws a ProviderDisabledError when Google is not enabled. */
  signInWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  /** Re-fetch /auth/me (used after company settings, onboarding or kill switch change). */
  refresh: () => Promise<void>
  /** Replace the company in context without a network call. */
  setCompany: (c: Company) => void
}

export class ProviderDisabledError extends Error {
  constructor() {
    super('Google sign-in is not enabled yet')
    this.name = 'ProviderDisabledError'
  }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompanyState] = useState<Company | null>(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [provider, setProvider] = useState<AuthProviderKind>('builtin')
  const [loading, setLoading] = useState<boolean>(true)
  const userRef = useRef<User | null>(null)
  userRef.current = user

  const clear = useCallback(() => {
    setUser(null)
    setCompanyState(null)
    setNeedsOnboarding(false)
  }, [])

  const applyMe = useCallback((data: MeResponse) => {
    setUser(data.user)
    setCompanyState(data.company)
    setNeedsOnboarding(!!data.needs_onboarding || !data.company)
  }, [])

  const applyAuth = useCallback((data: AuthResponse) => {
    setToken(data.access_token)
    setUser(data.user)
    setCompanyState(data.company)
    setNeedsOnboarding(!data.company)
  }, [])

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
    const { data } = await api.get<MeResponse>('/auth/me')
    applyMe(data)
  }, [applyMe, clear])

  // Boot: find out which sign-in system to use, then restore any existing session.
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    const boot = async () => {
      let config: AuthConfig = { provider: 'builtin' }
      try {
        const { data } = await api.get<AuthConfig>('/auth/config', { timeout: 15_000 })
        config = data
      } catch {
        // Backend unreachable or old backend without /auth/config: fall back to builtin auth.
      }
      if (cancelled) return

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
    async (email: string, password: string, code?: string) => {
      const sb = getSupabase()
      if (sb) {
        // Flaire's 2FA code is not part of Supabase sign-in; `code` is ignored here.
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new Error(supabaseErrorMessage(error))
        const { data } = await api.get<MeResponse>('/auth/me')
        applyMe(data)
        return { needs_onboarding: !!data.needs_onboarding || !data.company }
      }
      const { data } = await api.post<AuthResponse>('/auth/login', code ? { email, password, code } : { email, password })
      applyAuth(data)
      return { needs_onboarding: !data.company }
    },
    [applyAuth, applyMe],
  )

  const register = useCallback(
    async (input: { company_name: string; email: string; password: string; full_name: string }): Promise<RegisterResult> => {
      const sb = getSupabase()
      if (sb) {
        try {
          localStorage.setItem(PENDING_COMPANY_KEY, input.company_name)
        } catch {
          // storage unavailable, the welcome page will just ask
        }
        const { data, error } = await sb.auth.signUp({
          email: input.email,
          password: input.password,
          options: {
            data: { full_name: input.full_name },
            emailRedirectTo: `${window.location.origin}/welcome`,
          },
        })
        if (error) throw new Error(supabaseErrorMessage(error))
        if (data.session) {
          const me = await api.get<MeResponse>('/auth/me')
          applyMe(me.data)
          return { status: 'signed_in', needs_onboarding: !!me.data.needs_onboarding || !me.data.company }
        }
        return { status: 'confirm_email', email: input.email }
      }
      const { data } = await api.post<AuthResponse>('/auth/register', input)
      applyAuth(data)
      return { status: 'signed_in', needs_onboarding: !data.company }
    },
    [applyAuth, applyMe],
  )

  const forgot = useCallback(async (email: string): Promise<ForgotResult> => {
    const sb = getSupabase()
    if (sb) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset` })
      if (error) throw new Error(supabaseErrorMessage(error))
      return { ok: true, message: `If an account exists for ${email}, a reset link is on its way.` }
    }
    const { data } = await api.post<ForgotResult>('/auth/forgot', { email })
    return data
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const sb = getSupabase()
    if (!sb) throw new Error('Google sign-in is only available with Supabase auth.')
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/welcome` },
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

  const value = useMemo<AuthState>(
    () => ({
      user,
      company,
      needsOnboarding,
      provider,
      loading,
      isAuthenticated: !!user,
      login,
      register,
      forgot,
      signInWithGoogle,
      logout,
      refresh,
      setCompany: (c: Company) => {
        setCompanyState(c)
        setNeedsOnboarding(false)
      },
    }),
    [user, company, needsOnboarding, provider, loading, login, register, forgot, signInWithGoogle, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
