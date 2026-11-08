import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { useIsPhone } from '../lib/useMedia'
import { timeAgo } from '../lib/useFetch'
import type { AppNotification } from '../types'
import { BottomSheet } from './BottomSheet'

const POLL_MS = 60_000

/**
 * Header bell: unread badge, list of GET /notifications, tap marks one read and follows its url, "Mark all read".
 * Polls every 60 s while the tab is visible. A backend without /notifications just shows an empty bell.
 */
export function NotificationsBell({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const t = useT()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<AppNotification[]>('/notifications')
      setItems(Array.isArray(data) ? data : [])
    } catch {
      // Not available yet or offline: keep what we have.
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    let timer: number | null = null
    const start = () => {
      if (timer === null) timer = window.setInterval(() => void load(), POLL_MS)
    }
    const stop = () => {
      if (timer !== null) window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
        start()
      } else stop()
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // Desktop popover closes on outside click or Escape.
  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, phone])

  const unread = items.filter((n) => !n.read).length

  const markRead = async (ids: number[] | 'all') => {
    setItems((prev) => prev.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n)))
    try {
      await api.post('/notifications/read', ids === 'all' ? { all: true } : { ids })
    } catch {
      // The next poll puts it right.
    }
  }

  const openItem = (n: AppNotification) => {
    if (!n.read) void markRead([n.id])
    setOpen(false)
    const url = n.url || (n.request_id ? `/?decide=${n.request_id}` : null)
    if (!url) return
    if (/^https?:\/\//i.test(url)) window.location.assign(url)
    else navigate(url)
  }

  const list = (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-xs text-neutral-500 tnum">{unread > 0 ? t('notif.nUnread', { n: unread }) : t('notif.allRead')}</span>
        {unread > 0 && (
          <button type="button" className="btn-ghost text-xs h-7 px-2" onClick={() => void markRead('all')}>
            <CheckCheck className="h-3.5 w-3.5" /> {t('notif.markAllRead')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-neutral-500">{loaded ? t('notif.none') : t('common.loading')}</div>
      ) : (
        <ul className="divide-y divide-line overflow-y-auto max-h-[60vh] md:max-h-[420px]">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openItem(n)}
                className={`w-full text-start px-3 py-2.5 flex items-start gap-2.5 hover:bg-lavender ${n.read ? '' : 'bg-brand-tint/60'}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm truncate ${n.read ? 'font-medium text-neutral-600' : 'font-bold text-ink'}`}>{n.title}</span>
                  {n.body && <span className="block text-xs text-neutral-500 line-clamp-2">{n.body}</span>}
                  <span className="block text-[11px] text-neutral-400 mt-0.5">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost relative p-2 text-neutral-500"
        aria-label={t('notif.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -end-0.5 h-4 min-w-[16px] rounded-pill bg-brand px-1 text-[10px] font-bold text-white flex items-center justify-center tnum">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {phone ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={t('notif.title')}>
          {list}
        </BottomSheet>
      ) : (
        open && (
          <div
            role="dialog"
            aria-label={t('notif.title')}
            className={`absolute z-40 w-[340px] rounded-card-lg border border-line bg-white shadow-xl p-2 ${
              placement === 'bottom' ? 'bottom-full mb-2 start-0' : 'top-full mt-2 end-0'
            }`}
          >
            <div className="px-1 pt-1 pb-1 text-sm font-bold">{t('notif.title')}</div>
            {list}
          </div>
        )
      )}
    </div>
  )
}
