import axios, { AxiosError } from 'axios'
import type { ApiError } from '../types'
import { clearSupabaseToken, getSupabase, getSupabaseAccessToken, isSupabaseMode } from './supabase'

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8000/api/v1'

export const TOKEN_KEY = 'flaire_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable, ignore
  }
}

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60_000,
})

api.interceptors.request.use(async (config) => {
  // Supabase mode: the Supabase session access token is the Bearer token. Builtin mode: the stored Flaire token.
  const token = isSupabaseMode() ? await getSupabaseAccessToken() : getToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<ApiError>) => {
    const status = error.response?.status
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
    if (status === 401) {
      if (isSupabaseMode()) {
        clearSupabaseToken()
        try {
          await getSupabase()?.auth.signOut()
        } catch {
          // already signed out
        }
      } else {
        setToken(null)
      }
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
      }
    } else if (status === 403 && detail === 'onboarding_required') {
      // Signed in but no company yet: send them to the walkthrough, this is not a logout.
      if (!window.location.pathname.startsWith('/welcome')) {
        window.location.assign('/welcome')
      }
    }
    return Promise.reject(error)
  },
)

/** Extracts the backend `detail` message (or a sensible fallback) from any thrown error. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiError | { detail?: unknown } | undefined
    const detail = data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      // FastAPI validation errors
      return detail
        .map((d: { msg?: string; loc?: unknown[] }) =>
          d.loc ? `${(d.loc as unknown[]).slice(-1)[0]}: ${d.msg ?? ''}` : d.msg ?? '',
        )
        .join('; ')
    }
    if (err.code === 'ECONNABORTED') return 'The request timed out.'
    if (!err.response) return 'Cannot reach the Flaire API. Is the backend running?'
    return `Request failed (${err.response.status}).`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}


/**
 * Render's free tier sleeps after 15 minutes idle and takes 30 to 60 s to wake. Poll /health until it answers
 * (or give up after ~90 s). Returns true when the API is reachable.
 */
export async function wakeServer(onTick?: (seconds: number) => void, maxSeconds = 90): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < maxSeconds * 1000) {
    try {
      await api.get('/health', { timeout: 8_000 })
      return true
    } catch {
      onTick?.(Math.round((Date.now() - started) / 1000))
      await new Promise((r) => setTimeout(r, 3_000))
    }
  }
  return false
}

/** Downloads a file from an authenticated API route by fetching it as a blob and clicking a temporary link. */
export async function downloadFile(path: string, filename: string, params?: Record<string, unknown>): Promise<void> {
  const { data, headers } = await api.get<Blob>(path, { responseType: 'blob', params })
  const disposition = String(headers['content-disposition'] ?? '')
  const m = /filename="?([^";]+)"?/.exec(disposition)
  const name = m?.[1] || filename
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** A policy PATCH answered 202: the change waits for a second admin. Returns the pending change id, or null. */
export function pendingChangeId(res: { status: number; data: unknown }): number | null {
  if (res.status !== 202) return null
  const id = (res.data as { pending_change_id?: unknown } | null)?.pending_change_id
  return typeof id === 'number' ? id : null
}

export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response
}
