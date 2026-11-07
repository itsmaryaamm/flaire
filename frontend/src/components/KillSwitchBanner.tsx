import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

export function KillSwitchBanner() {
  const { company } = useAuth()
  const t = useT()
  if (!company?.kill_switch) return null
  return (
    <div
      role="alert"
      className="bg-danger text-white text-sm font-semibold px-4 py-2 flex items-center justify-center gap-2 text-center"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>{t('kill.banner')}</span>
    </div>
  )
}
