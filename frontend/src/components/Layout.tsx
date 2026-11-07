import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Bot,
  PieChart,
  CheckSquare,
  ArrowLeftRight,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  Smartphone,
  LifeBuoy,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import type { DashboardSummary } from '../types'
import { KillSwitchBanner } from './KillSwitchBanner'
import { setPreferFullDashboard } from '../lib/prefs'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; onClick?: () => void }

const nav: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/agents', label: 'AI employees', icon: Bot },
  { to: '/budgets', label: 'Departments', icon: PieChart },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/transactions', label: 'Activity', icon: ArrowLeftRight },
  { to: '/cards', label: 'Cards', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
  // Phone view: the simple approvals screen. Clears the "prefer full dashboard" choice so "/" routes to it again on a phone.
  { to: '/m', label: 'Phone view', icon: Smartphone, onClick: () => setPreferFullDashboard(false) },
]

// The mobile bottom bar shows the 5 most used destinations; the rest live in the sheet menu.
const mobilePrimary = ['/', '/agents', '/approvals', '/transactions', '/cards']

function Logo({ mark = false }: { mark?: boolean }) {
  return mark ? (
    <img src="/flaire-mark.png" alt="Flaire" className="h-7 w-auto" />
  ) : (
    <img src="/flaire-logo.png" alt="Flaire" className="h-7 w-auto" />
  )
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="ml-auto inline-flex min-w-[20px] h-5 items-center justify-center rounded-pill bg-brand px-1.5 text-[11px] font-bold text-white tnum">
      {n}
    </span>
  )
}

function ConnectedAgents({ count }: { count: number }) {
  return (
    <div>
      <div className="rounded-input border border-line bg-white px-3.5 py-3">
        <div className="mono-label mb-2">Connected agents</div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-success shrink-0" />
          {count} active AI employee{count === 1 ? '' : 's'}
        </div>
      </div>
      <div className="mt-3 font-mono text-[11px] leading-snug text-neutral-500">Simulation · no real money moves</div>
    </div>
  )
}

export function Layout() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const summary = useFetch(() => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data), [location.pathname])
  const pendingCount = summary.data?.totals.pending_count ?? 0
  const agentCount = summary.data?.agents?.filter((a) => a.status === 'active').length ?? summary.data?.totals.agent_count ?? 0

  const doLogout = async () => {
    await logout()
    navigate('/login')
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-semibold transition-colors ${
      isActive ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender hover:text-ink'
    }`

  const badgeFor = (to: string) => (to === '/approvals' ? <CountBadge n={pendingCount} /> : null)

  return (
    <div className="min-h-screen flex flex-col">
      <KillSwitchBanner />
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col w-[220px] shrink-0 border-r border-line bg-white sticky top-0 h-screen">
          <div className="px-5 pt-6 pb-5">
            <Logo />
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkClass} onClick={n.onClick}>
                <n.icon className="h-4 w-4" />
                {n.label}
                {badgeFor(n.to)}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 pb-5">
            <ConnectedAgents count={agentCount} />
            <div className="mt-4 pt-4 border-t border-line">
              <div className="text-sm font-semibold truncate">{company?.name}</div>
              <div className="text-xs text-neutral-500 truncate" title={user?.email}>{user?.email}</div>
              <Link to="/welcome" className="btn-ghost mt-1.5 w-full justify-start px-2 text-xs">
                <LifeBuoy className="h-3.5 w-3.5" /> Help: restart walkthrough
              </Link>
              <button onClick={doLogout} className="btn-ghost w-full justify-start px-2 text-xs">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-line px-4 h-14 flex items-center justify-between">
            <Logo />
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="btn-ghost p-2"
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </header>
          {menuOpen && (
            <div className="md:hidden fixed inset-0 z-40 bg-ink/30" onClick={() => setMenuOpen(false)}>
              <div
                className="absolute top-14 right-0 left-0 bg-white border-b border-line p-3 space-y-1 rounded-b-card"
                onClick={(e) => e.stopPropagation()}
              >
                {nav.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={linkClass}
                    onClick={() => {
                      n.onClick?.()
                      setMenuOpen(false)
                    }}
                  >
                    <n.icon className="h-4 w-4" />
                    {n.label}
                    {badgeFor(n.to)}
                  </NavLink>
                ))}
                <div className="border-t border-line pt-3 mt-2 px-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{company?.name}</div>
                    <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
                    <Link to="/welcome" className="text-xs text-brand font-semibold hover:underline" onClick={() => setMenuOpen(false)}>
                      Help: restart walkthrough
                    </Link>
                  </div>
                  <button onClick={doLogout} className="btn-secondary text-xs">
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              </div>
            </div>
          )}

          <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-10 max-w-[1240px] w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line grid grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
        {nav
          .filter((n) => mobilePrimary.includes(n.to))
          .map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold ${
                  isActive ? 'text-brand' : 'text-neutral-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`inline-flex h-8 w-12 items-center justify-center rounded-pill ${isActive ? 'bg-brand-light' : ''}`}>
                    <n.icon className="h-5 w-5" />
                    {n.to === '/approvals' && pendingCount > 0 && (
                      <span className="absolute top-1 right-3 h-4 min-w-[16px] rounded-pill bg-brand px-1 text-[10px] font-bold text-white flex items-center justify-center">
                        {pendingCount}
                      </span>
                    )}
                  </span>
                  <span className="truncate max-w-[64px]">{n.label === 'AI employees' ? 'Agents' : n.label}</span>
                </>
              )}
            </NavLink>
          ))}
      </nav>
    </div>
  )
}
