import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Users } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { CompanyCard } from '../components/settings/CompanyCard'
import { ConnectClaudeCard } from '../components/settings/ConnectClaudeCard'
import { PaymentsCard } from '../components/settings/PaymentsCard'
import { NotificationsCard } from '../components/settings/NotificationsCard'
import { SecurityCard } from '../components/settings/SecurityCard'
import { ApprovalRulesCard, SupplierPolicyCard } from '../components/settings/PolicyCards'
import { AdvancedCard } from '../components/settings/AdvancedCard'
import { DangerZoneCard } from '../components/settings/DangerZoneCard'
import { useT } from '../lib/i18n'

/** Settings: one vertical list of cards. Deep links like /settings#connect scroll to that card. */
export default function SettingsPage() {
  const t = useT()
  const location = useLocation()
  useEffect(() => {
    const id = location.hash.replace('#', '')
    if (!id) return
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    return () => window.clearTimeout(t)
  }, [location.hash])

  return (
    <div className="max-w-[760px]">
      <PageHeader title={t('nav.settings')} />
      <div className="space-y-5">
        {/* Phones have three tabs; Employees lives here. */}
        <Link to="/employees" className="md:hidden card-lg px-5 py-4 flex items-center gap-3 hover:bg-lavender">
          <Users className="h-4 w-4 text-brand" />
          <span className="font-bold flex-1">{t('nav.employees')}</span>
          <ChevronRight className="h-4 w-4 text-neutral-400 rtl-flip" />
        </Link>
        <CompanyCard />
        <ConnectClaudeCard />
        <PaymentsCard />
        <NotificationsCard />
        <SecurityCard />
        <SupplierPolicyCard />
        <ApprovalRulesCard />
        <AdvancedCard />
        <DangerZoneCard />
      </div>
    </div>
  )
}
