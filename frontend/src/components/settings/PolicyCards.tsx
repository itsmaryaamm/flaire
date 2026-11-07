import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Store } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { useT } from '../../lib/i18n'
import { usePendingChange } from '../../lib/pending'
import type { Company } from '../../types'

type Patch = Partial<Pick<Company, 'require_password_on_approve' | 'two_person_threshold' | 'trusted_merchants' | 'new_merchant_review_from' | 'require_change_approval'>>

/** PATCH /company. A 202 means the change waits for a second admin: toast and leave the company as is. */
function useCompanyPatch() {
  const { setCompany } = useAuth()
  const toast = useToast()
  const pending = usePendingChange()
  return async (patch: Patch, message: string) => {
    try {
      const res = await api.patch<Company>('/company', patch)
      if (pending(res)) return
      setCompany(res.data)
      toast.success(message)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
}

/** Settings card: trusted suppliers and new-supplier review. */
export function SupplierPolicyCard() {
  const { company } = useAuth()
  const t = useT()
  const save = useCompanyPatch()
  const [trusted, setTrusted] = useState<string>((company?.trusted_merchants ?? []).join(', '))
  const [newMerchant, setNewMerchant] = useState<string>(String((company?.new_merchant_review_from ?? 20000) / 100))
  useEffect(() => {
    if (company) {
      setTrusted((company.trusted_merchants ?? []).join(', '))
      setNewMerchant(String(company.new_merchant_review_from / 100))
    }
  }, [company])

  return (
    <section id="suppliers" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Store className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.supplierPolicy')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('settings.supplierHint')}</p>
      <label className="label" htmlFor="trusted">{t('settings.trustedSuppliers')}</label>
      <textarea id="trusted" className="input min-h-[64px]" placeholder="Google Ads, Canva, Aramex" value={trusted} onChange={(e) => setTrusted(e.target.value)} />
      <p className="text-xs text-neutral-500 mt-1 mb-3">{t('settings.trustedHint')}</p>
      <label className="label" htmlFor="newm">{t('settings.newSupplierFrom')}</label>
      <div className="flex gap-2">
        <input id="newm" className="input tnum sm:w-48" type="number" min={0} step={50} value={newMerchant} onChange={(e) => setNewMerchant(e.target.value)} />
        <button
          className="btn-secondary"
          onClick={() =>
            save(
              {
                trusted_merchants: trusted.split(',').map((m) => m.trim()).filter(Boolean),
                new_merchant_review_from: Math.round(Number(newMerchant) * 100),
              },
              t('settings.supplierSaved'),
            )
          }
        >
          {t('settings.savePolicy')}
        </button>
      </div>
      <p className="text-xs text-neutral-500 mt-1">{t('settings.newSupplierHint')}</p>
    </section>
  )
}

/** Settings card: two-person rule, password re-entry, and four-eyes on policy changes. */
export function ApprovalRulesCard() {
  const { company } = useAuth()
  const t = useT()
  const save = useCompanyPatch()
  const [twoPerson, setTwoPerson] = useState<string>(String((company?.two_person_threshold ?? 250000) / 100))
  useEffect(() => {
    if (company) setTwoPerson(String(company.two_person_threshold / 100))
  }, [company])

  return (
    <section id="approvals" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.approvalRules')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('settings.approvalRulesHint')}</p>
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 accent-brand"
          checked={company?.require_password_on_approve ?? true}
          onChange={(e) => save({ require_password_on_approve: e.target.checked }, t('settings.approvalRulesSaved'))}
        />
        <span>
          <span className="font-semibold">{t('settings.passwordReentry')}</span>
          <span className="block text-xs text-neutral-500">{t('settings.passwordReentryHint')}</span>
        </span>
      </label>
      <label className="mt-3 flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 accent-brand"
          checked={company?.require_change_approval ?? false}
          onChange={(e) => save({ require_change_approval: e.target.checked }, t('settings.approvalRulesSaved'))}
        />
        <span>
          <span className="font-semibold">{t('settings.requireChangeApproval')}</span>
          <span className="block text-xs text-neutral-500">
            {t('settings.requireChangeApprovalHint')}{' '}
            <Link to="/policy" className="text-brand font-semibold hover:underline">
              {t('policy.openPolicy')}
            </Link>
          </span>
        </span>
      </label>
      <div className="mt-4">
        <label className="label" htmlFor="two-person">{t('settings.twoPersonFrom')}</label>
        <div className="flex gap-2">
          <input id="two-person" className="input tnum sm:w-48" type="number" min={0} step={100} value={twoPerson} onChange={(e) => setTwoPerson(e.target.value)} />
          <button
            className="btn-secondary"
            onClick={() => save({ two_person_threshold: Math.round(Number(twoPerson) * 100) }, t('settings.approvalRulesSaved'))}
            disabled={Math.round(Number(twoPerson) * 100) === company?.two_person_threshold}
          >
            {t('common.save')}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-1">{t('settings.twoPersonHint')}</p>
      </div>
      <p className="text-xs text-neutral-500 mt-4 pt-3 border-t border-line">
        {t('settings.chainsLiveOnTeam')}{' '}
        <Link to="/team#chains" className="text-brand font-semibold hover:underline">
          {t('nav.team')}
        </Link>
      </p>
    </section>
  )
}
