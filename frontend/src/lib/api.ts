import axios, { AxiosError } from 'axios'
import type { ApiError } from '../types'

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

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      setToken(null)
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
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

export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response
}
