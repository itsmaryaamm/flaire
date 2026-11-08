import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { getViewMode, setViewMode as persistViewMode } from './prefs'
import type { ViewMode } from './prefs'
import { useIsPhone } from './useMedia'
import { ADMIN_VIEW_ROLES } from '../types'
import type { Role } from '../types'

interface ViewState {
  /** The mode in effect. Roles without the admin view always get "my". */
  mode: ViewMode
  /** Whether this user may switch at all. Never on phones: the phone app has one view per role. */
  canSwitch: boolean
  /** True below the md breakpoint. Pages use it to drop the desktop-only blocks. */
  phone: boolean
  setMode: (mode: ViewMode) => void
}

const ViewContext = createContext<ViewState | null>(null)

export function hasAdminView(role: string | undefined | null): boolean {
  return !!role && ADMIN_VIEW_ROLES.includes(role as Role)
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const phone = useIsPhone()
  const [stored, setStored] = useState<ViewMode>(getViewMode)
  const adminRole = hasAdminView(user?.role)
  const canSwitch = false // the role decides the view; there is no toggle

  const setMode = useCallback((mode: ViewMode) => {
    persistViewMode(mode)
    setStored(mode)
  }, [])

  const value = useMemo<ViewState>(() => {
    // Phone: admin roles see the company queue, everyone else their own; no toggle.
    const mode: ViewMode = adminRole ? 'admin' : 'my'
    return { mode, canSwitch, phone, setMode }
  }, [adminRole, canSwitch, phone, stored, setMode])
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext)
  if (!ctx) throw new Error('useView must be used inside ViewProvider')
  return ctx
}
