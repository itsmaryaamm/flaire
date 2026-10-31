import { NavLink, Outlet, useNavigate } from 'react-router-dom'
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
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { KillSwitchBanner } from './KillSwitchBanner'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/agents', label: 'AI employees', icon: Bot },
  { to: '/budgets', label: 'Departments', icon: PieChart },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/cards', label: 'Cards', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

// The mobile bottom bar shows the 5 most used destinations; the rest live in the sheet menu.
const mobilePrimary = ['/', '/agents', '/approvals', '/transactions', '/cards']

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white font-bold text-lg leading-none">
        F
      </span>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">Flaire</div>
        <div className="text-[11px] text-neutral-500">Finance for AI employees</div>
      </div>
    </div>
  )
}

export function Layout() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const doLogout = () => {
    logout()
    navigate('/login')
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-brand text-white' : 'text-neutral-700 hover:bg-neutral-200/60'
    }`

  return (
    <div className="min-h-screen flex flex-col">
      <KillSwitchBanner />
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-neutral-200 bg-canvas sticky top-0 h-screen">
          <div className="px-5 py-5">
            <Logo />
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={linkClass}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 py-4 border-t border-neutral-200">
            <div className="text-sm font-medium truncate">{company?.name}</div>
            <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
            <button onClick={doLogout} className="btn-ghost mt-2 w-full justify-start px-2 text-xs">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
            <div className="mt-3 text-[11px] text-neutral-400">Simulation. No real money moves.</div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="md:hidden sticky top-0 z-30 bg-canvas/95 backdrop-blur border-b border-neutral-200 px-4 h-14 flex items-center justify-between">
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
                className="absolute top-14 right-0 left-0 bg-white border-b border-neutral-200 p-3 space-y-1"
                onClick={(e) => e.stopPropagation()}
              >
                {nav.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={linkClass}
                    onClick={() => setMenuOpen(false)}
                  >
                    <n.icon className="h-4 w-4" />
                    {n.label}
                  </NavLink>
                ))}
                <div className="border-t border-neutral-200 pt-2 mt-2 px-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{company?.name}</div>
                    <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
                  </div>
                  <button onClick={doLogout} className="btn-secondary text-xs">
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              </div>
            </div>
          )}

          <main className="flex-1 px-4 py-5 md:px-8 md:py-8 pb-24 md:pb-8 max-w-7xl w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-neutral-200 grid grid-cols-5">
        {nav
          .filter((n) => mobilePrimary.includes(n.to))
          .map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                  isActive ? 'text-brand' : 'text-neutral-500'
                }`
              }
            >
              <n.icon className="h-5 w-5" />
              <span className="truncate max-w-[64px]">{n.label === 'AI employees' ? 'Agents' : n.label}</span>
            </NavLink>
          ))}
      </nav>
    </div>
  )
}
