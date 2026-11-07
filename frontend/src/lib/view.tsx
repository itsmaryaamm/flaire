import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import { getViewMode, setViewMode as persistViewMode } from './prefs'
import type { ViewMode } from './prefs'
import { ADMIN_VIEW_ROLES } from '../types'
import type { Role } from '../types'

interface ViewState {
  /** The mode in effect. Roles without the admin view always get "my". */
  mode: ViewMode
  /** Whether this user may switch at all. */
  canSwitch: boolean
  setMode: (mode: ViewMode) => void
}

const ViewContext = createContext<ViewState | null>(null)

export function hasAdminView(role: string | undefined | null): boolean {
  return !!role && ADMIN_VIEW_ROLES.includes(role as Role)
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [stored, setStored] = useState<ViewMode>(getViewMode)
  const canSwitch = hasAdminView(user?.role)

  const setMode = useCallback((mode: ViewMode) => {
    persistViewMode(mode)
    setStored(mode)
  }, [])

  const value = useMemo<ViewState>(() => ({ mode: canSwitch ? stored : 'my', canSwitch, setMode }), [canSwitch, stored, setMode])
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export function useView(): ViewState {
  const ctx = useContext(ViewContext)
  if (!ctx) throw new Error('useView must be used inside ViewProvider')
  return ctx
}
