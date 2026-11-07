import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import type { AuthResponse, Company, User } from '../types'

interface AuthState {
  user: User | null
  company: Company | null
  loading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string, code?: string) => Promise<void>
  register: (input: {
    company_name: string
    email: string
    password: string
    full_name: string
  }) => Promise<void>
  logout: () => void
  /** Re-fetch /auth/me (used after company settings or kill switch change). */
  refresh: () => Promise<void>
  /** Replace the company in context without a network call. */
  setCompany: (c: Company) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompanyState] = useState<Company | null>(null)
  const [loading, setLoading] = useState<boolean>(() => !!getToken())

  const applyAuth = useCallback((data: AuthResponse) => {
    setToken(data.access_token)
    setUser(data.user)
    setCompanyState(data.company)
  }, [])

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setCompanyState(null)
      return
    }
    const { data } = await api.get<{ user: User; company: Company }>('/auth/me')
    setUser(data.user)
    setCompanyState(data.company)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!getToken()) {
      setLoading(false)
      return
    }
    refresh()
      .catch(() => {
        setToken(null)
        setUser(null)
        setCompanyState(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string, code?: string) => {
      const { data } = await api.post<AuthResponse>('/auth/login', code ? { email, password, code } : { email, password })
      applyAuth(data)
    },
    [applyAuth],
  )

  const register = useCallback(
    async (input: { company_name: string; email: string; password: string; full_name: string }) => {
      const { data } = await api.post<AuthResponse>('/auth/register', input)
      applyAuth(data)
    },
    [applyAuth],
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setCompanyState(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      company,
      loading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      refresh,
      setCompany: setCompanyState,
    }),
    [user, company, loading, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
