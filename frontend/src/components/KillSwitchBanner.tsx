import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../lib/auth'

export function KillSwitchBanner() {
  const { company } = useAuth()
  if (!company?.kill_switch) return null
  return (
    <div
      role="alert"
      className="bg-red-600 text-white text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 text-center"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>Kill switch ON: all new AI spending is disabled.</span>
    </div>
  )
}
