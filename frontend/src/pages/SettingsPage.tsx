import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
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
