import { useMemo } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, Users, Activity, Settings, LogOut, ShieldAlert, ShieldCheck, UserCog, Landmark, Scale, Server } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import { useView, hasAdminView } from '../lib/view'
import type { PurchaseRequest } from '../types'
import { KillSwitchBanner } from './KillSwitchBanner'
import { useKillSwitch } from './KillSwitchPanel'
import { NotificationsBell } from './NotificationsBell'

type NavItem = { to: string; key: string; icon: typeof Home; end?: boolean }

const ALL_NAV: (NavItem & { admin?: boolean })[] = [
  { to: '/', key: 'nav.home', icon: Home, end: true },
  { to: '/employees', key: 'nav.employees', icon: Users },
  { to: '/activity', key: 'nav.activity', icon: Activity },
  { to: '/team', key: 'nav.team', icon: UserCog },
  { to: '/finance', key: 'nav.finance', icon: Landmark, admin: true },
  { to: '/policy', key: 'nav.policy', icon: Scale, admin: true },
  { to: '/settings', key: 'nav.settings', icon: Settings },
]

const PLATFORM_NAV: NavItem = { to: '/platform', key: 'nav.platform', icon: Server }

/** Phone tabs: the simplest app. Employees is reachable from Settings. */
const PHONE_TABS = ['/', '/activity', '/settings']

/** Nav items this role may open on desktop. Platform staff also get the console. */
export function navForRole(role: string | undefined | null, platformAdmin = false): NavItem[] {
  const admin = hasAdminView(role)
  const items: NavItem[] = ALL_NAV.filter((n) => !n.admin || admin)
  return platformAdmin ? [...items, PLATFORM_NAV] : items
}

function initials(name: string | undefined, email: string | undefined): string {
  const src = (name ?? '').trim() || (email ?? '').split('@')[0] || '?'
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)
  return chars.toUpperCase()
}

/** Small kill switch state pill. Red when ON. Tapping opens the shared reason / confirm modal. */
export function KillSwitchPill({ className = '' }: { className?: string }) {
  const { on, openModal, modal } = useKillSwitch()
  const t = useT()
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={openModal}
        className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold transition-colors ${
          on ? 'bg-danger border-danger text-white hover:bg-[#C8262E]' : 'bg-white border-line-strong text-neutral-600 hover:bg-lavender'
        } ${className}`}
        title={on ? t('kill.onHint') : t('kill.offHint')}
      >
        {on ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5 text-success" />}
        {on ? t('kill.on') : t('kill.off')}
      </button>
      {modal}
    </>
  )
}

/** "My view | Admin view" segmented toggle. Desktop only, and only for roles that have an admin view. */
export function ViewToggle({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const { mode, canSwitch, setMode } = useView()
  const t = useT()
  if (!canSwitch) return null
  const btn = (value: 'my' | 'admin', label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`rounded-pill ${compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs'} font-semibold transition-colors whitespace-nowrap ${
        mode === value ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className={`inline-flex rounded-pill border border-line bg-white p-0.5 ${className}`} role="group" aria-label={t('view.label')}>
      {btn('my', t('view.my'))}
      {btn('admin', t('view.admin'))}
    </div>
  )
}

/**
 * One responsive shell. Desktop (md and up): slim sidebar on the start side (left in English, right in Arabic) with every destination.
 * Phones: three bottom tabs (Home, Activity, Settings) and a top bar with the bell.
 */
export function Layout() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()
  const pending = useFetch(() => api.get<PurchaseRequest[]>('/approvals').then((r) => r.data), [location.pathname])
  const pendingCount = pending.data?.length ?? 0
  const nav = useMemo(() => navForRole(user?.role, !!user?.is_platform_admin), [user?.role, user?.is_platform_admin])
  const phoneTabs = useMemo(() => PHONE_TABS.map((to) => ALL_NAV.find((n) => n.to === to)!), [])

  const doLogout = async () => {
    await logout()
    navigate('/login')
  }

  const badge = (to: string) =>
    to === '/' && pendingCount > 0 ? (
      <span className="ms-auto inline-flex min-w-[20px] h-5 items-center justify-center rounded-pill bg-brand px-1.5 text-[11px] font-bold text-white tnum">
        {pendingCount}
      </span>
    ) : null

  const tabClass = (isActive: boolean) => `relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${isActive ? 'text-brand' : 'text-neutral-500'}`

  return (
    <div className="min-h-screen flex flex-col">
      <KillSwitchBanner />
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col w-[200px] shrink-0 border-e border-line bg-white sticky top-0 h-screen">
          <div className="px-5 pt-6 pb-4">
            <img src="/flaire-logo.png" alt="Flaire" className="h-7 w-auto" />
          </div>
          <div className="px-3 pb-3">
            <ViewToggle className="w-full justify-center" compact />
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender hover:text-ink'
                  }`
                }
              >
                <n.icon className="h-4 w-4" />
                {t(n.key)}
                {badge(n.to)}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 pb-5 space-y-4">
            <KillSwitchPill className="w-full justify-center" />
            <div className="pt-4 border-t border-line flex items-center gap-1.5">
              <span className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full bg-brand text-white text-xs font-bold">
                {initials(user?.full_name, user?.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{user?.full_name || company?.name}</div>
                <div className="text-[11px] text-neutral-500 truncate" title={user?.email}>
                  {user?.role ? t(`role.${user.role}`) : user?.email}
                </div>
              </div>
              <NotificationsBell placement="bottom" />
              <button onClick={doLogout} className="btn-ghost p-1.5" aria-label={t('auth.signOut')} title={t('auth.signOut')}>
                <LogOut className="h-4 w-4 rtl-flip" />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Phone top bar */}
          <header className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-line px-4 h-14 flex items-center justify-between gap-2 pt-[env(safe-area-inset-top)]">
            <img src="/flaire-logo.png" alt="Flaire" className="h-6 w-auto shrink-0" />
            <div className="flex items-center gap-1">
              <NotificationsBell />
              <button onClick={doLogout} className="btn-ghost p-2 text-neutral-500 shrink-0" aria-label={t('auth.signOut')}>
                <LogOut className="h-4 w-4 rtl-flip" />
              </button>
            </div>
          </header>

          <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 py-5 md:px-8 md:py-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Phone bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line grid grid-cols-3 h-16 pb-[env(safe-area-inset-bottom)]">
        {phoneTabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => tabClass(isActive)}>
            {({ isActive }) => (
              <>
                <span className={`inline-flex h-7 w-12 items-center justify-center rounded-pill ${isActive ? 'bg-brand-light' : ''}`}>
                  <n.icon className="h-5 w-5" />
                  {n.to === '/' && pendingCount > 0 && (
                    <span className="absolute top-1.5 end-[calc(50%-22px)] h-4 min-w-[16px] rounded-pill bg-brand px-1 text-[10px] font-bold text-white flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full px-0.5">{t(n.key)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
