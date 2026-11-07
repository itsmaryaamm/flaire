import { useEffect, useState } from 'react'
import { ShieldCheck, Store } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import type { Company } from '../../types'

type Patch = Partial<Pick<Company, 'require_password_on_approve' | 'two_person_threshold' | 'trusted_merchants' | 'new_merchant_review_from'>>

function useCompanyPatch() {
  const { setCompany } = useAuth()
  const toast = useToast()
  return async (patch: Patch, message = 'Saved.') => {
    try {
      const { data } = await api.patch<Company>('/company', patch)
      setCompany(data)
      toast.success(message)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
}

/** Settings card: trusted suppliers and new-supplier review. */
export function SupplierPolicyCard() {
  const { company } = useAuth()
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
        <h3 className="font-bold">Supplier policy</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">Trusted suppliers get paid within limits. Unknown suppliers get a look first.</p>
      <label className="label" htmlFor="trusted">Trusted suppliers</label>
      <textarea id="trusted" className="input min-h-[64px]" placeholder="Google Ads, Canva, Aramex" value={trusted} onChange={(e) => setTrusted(e.target.value)} />
      <p className="text-xs text-neutral-500 mt-1 mb-3">Comma separated. Purchases at these suppliers skip the category check. Limits and thresholds still apply.</p>
      <label className="label" htmlFor="newm">Review first payment to a new supplier from (SAR)</label>
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
              'Supplier policy saved.',
            )
          }
        >
          Save policy
        </button>
      </div>
      <p className="text-xs text-neutral-500 mt-1">The first payment to a supplier you have never paid waits for a human at or above this amount. 0 turns this off.</p>
    </section>
  )
}

/** Settings card: two-person rule and password re-entry. */
export function ApprovalRulesCard() {
  const { company } = useAuth()
  const save = useCompanyPatch()
  const [twoPerson, setTwoPerson] = useState<string>(String((company?.two_person_threshold ?? 250000) / 100))
  useEffect(() => {
    if (company) setTwoPerson(String(company.two_person_threshold / 100))
  }, [company])

  return (
    <section id="approvals" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Approval rules</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">Enforced by the server on every approval, never by the AI.</p>
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 accent-brand"
          checked={company?.require_password_on_approve ?? true}
          onChange={(e) => save({ require_password_on_approve: e.target.checked }, 'Approval rules saved.')}
        />
        <span>
          <span className="font-semibold">Password re-entry on every approval</span>
          <span className="block text-xs text-neutral-500">A stolen session or an unlocked laptop cannot approve spending.</span>
        </span>
      </label>
      <div className="mt-4">
        <label className="label" htmlFor="two-person">Two-person rule from (SAR)</label>
        <div className="flex gap-2">
          <input id="two-person" className="input tnum sm:w-48" type="number" min={0} step={100} value={twoPerson} onChange={(e) => setTwoPerson(e.target.value)} />
          <button
            className="btn-secondary"
            onClick={() => save({ two_person_threshold: Math.round(Number(twoPerson) * 100) }, 'Approval rules saved.')}
            disabled={Math.round(Number(twoPerson) * 100) === company?.two_person_threshold}
          >
            Save
          </button>
        </div>
        <p className="text-xs text-neutral-500 mt-1">Approvals at or above this amount need two different humans before money moves. 0 requires it for everything.</p>
      </div>
    </section>
  )
}
