import { createClient } from '@supabase/supabase-js'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

/** Which sign-in system the backend told us to use (GET /auth/config). */
export type AuthProviderKind = 'supabase' | 'builtin'

let client: SupabaseClient | null = null
let currentProvider: AuthProviderKind = 'builtin'
let cachedToken: string | null = null

export function getProvider(): AuthProviderKind {
  return currentProvider
}

export function setProvider(p: AuthProviderKind) {
  currentProvider = p
}

export function isSupabaseMode(): boolean {
  return currentProvider === 'supabase' && client !== null
}

/** The Supabase client, or null when the backend runs its built-in auth. */
export function getSupabase(): SupabaseClient | null {
  return client
}

/** Create the client once. Safe to call again; the first client wins. */
export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (client) return client
  client = createClient(url, anonKey, {
    auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  })
  currentProvider = 'supabase'
  // Keep a copy of the access token so the request interceptor does not have to await getSession() every time.
  client.auth.onAuthStateChange((_event, session: Session | null) => {
    cachedToken = session?.access_token ?? null
  })
  return client
}

/** Access token for the Authorization header. Uses the cached copy, falling back to getSession(). */
export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!client) return null
  if (cachedToken) return cachedToken
  try {
    const { data } = await client.auth.getSession()
    cachedToken = data.session?.access_token ?? null
  } catch {
    cachedToken = null
  }
  return cachedToken
}

export function clearSupabaseToken() {
  cachedToken = null
}

/** True when a Supabase error means the OAuth provider is not switched on in the project. */
export function isProviderDisabledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return /provider.*not enabled|unsupported provider|not enabled/i.test(msg)
}

/** Friendlier wording for the most common Supabase auth errors. */
export function supabaseErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong.'
  if (/email not confirmed/i.test(msg)) {
    return 'Your email is not confirmed yet. Open the confirmation link we sent you, then sign in.'
  }
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.'
  return msg
}
