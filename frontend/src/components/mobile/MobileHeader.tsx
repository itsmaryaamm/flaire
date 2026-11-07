import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, LogOut, RefreshCw } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { setPreferFullDashboard } from '../../lib/prefs'

function initials(name: string | undefined, email: string | undefined): string {
  const src = (name ?? '').trim() || (email ?? '').split('@')[0] || '?'
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)
  return chars.toUpperCase()
}

export function MobileHeader({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  const goFull = () => {
    setPreferFullDashboard(true)
    setOpen(false)
    navigate('/?full=1')
  }

  const signOut = () => {
    setOpen(false)
    logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 bg-canvas/95 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="flex items-center gap-3 h-16 px-4">
        <img src="/flaire-mark.png" alt="Flaire" className="h-7 w-7 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold truncate leading-tight">{company?.name ?? 'Flaire'}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500">Approvals on the go</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="h-11 w-11 inline-flex items-center justify-center rounded-full text-neutral-600 hover:bg-lavender disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Account menu"
            className="h-11 w-11 inline-flex items-center justify-center rounded-full bg-brand text-white text-sm font-bold shadow-primary"
          >
            {initials(user?.full_name, user?.email)}
          </button>
          {open && (
            <div role="menu" className="absolute right-0 mt-2 w-56 card-lg p-1.5 shadow-lg">
              <div className="px-3 py-2 border-b border-line mb-1">
                <div className="text-sm font-semibold truncate">{user?.full_name}</div>
                <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
              </div>
              <button role="menuitem" onClick={goFull} className="w-full flex items-center gap-2.5 rounded-input px-3 h-11 text-sm font-semibold text-ink hover:bg-lavender">
                <LayoutDashboard className="h-4 w-4 text-brand" /> Full dashboard
              </button>
              <button role="menuitem" onClick={signOut} className="w-full flex items-center gap-2.5 rounded-input px-3 h-11 text-sm font-semibold text-neutral-600 hover:bg-lavender">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
