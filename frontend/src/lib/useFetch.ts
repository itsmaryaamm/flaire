import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'
import { moneyLocale } from './money'
import { dateLocaleTag, translate } from './i18n'

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  setData: (updater: T | ((prev: T | null) => T | null)) => void
}

/**
 * Minimal data hook: runs `fetcher` on mount and whenever `deps` change,
 * exposes `refetch` so pages can reload lists after mutations.
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const run = useCallback(async () => {
    const mySeq = ++seq.current
    setLoading(true)
    try {
      const result = await fetcherRef.current()
      if (mySeq === seq.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (mySeq === seq.current) setError(errorMessage(err))
    } finally {
      if (mySeq === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error, refetch: run, setData }
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(dateLocaleTag(moneyLocale()), {
    day: '2-digit',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

/** Clock time only, e.g. "10:13". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString(dateLocaleTag(moneyLocale()), { hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso: string | null | undefined): string {
  const loc = moneyLocale()
  if (!iso) return translate(loc, 'time.never')
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return iso
  const s = Math.floor(diff / 1000)
  if (s < 60) return translate(loc, 'time.justNow')
  const m = Math.floor(s / 60)
  if (m < 60) return translate(loc, 'time.minutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return translate(loc, 'time.hoursAgo', { n: h })
  const d = Math.floor(h / 24)
  return translate(loc, 'time.daysAgo', { n: d })
}
