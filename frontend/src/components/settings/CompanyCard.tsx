import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { formatDate } from '../../lib/useFetch'
import type { Company } from '../../types'
import { Spinner } from '../Spinner'
import { LanguageSwitch, useT } from '../../lib/i18n'

/** Settings card: company name and the walkthrough link. */
export function CompanyCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const t = useT()
  const [name, setName] = useState(company?.name ?? '')
  const [saving, setSaving] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.patch<Company>('/company', { name: name.trim() })
      setCompany(data)
      toast.success(t('settings.companyNameUpdated'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="company" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.company')}</h3>
      </div>
      <form onSubmit={save} className="mt-3 flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="company-name">{t('auth.companyName')}</label>
          <input id="company-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary self-end" disabled={saving || name.trim() === company?.name}>
          {saving && <Spinner />} {t('common.save')}
        </button>
      </form>
      <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>
          {company?.currency ?? 'SAR'} · {t('settings.since', { date: formatDate(company?.created_at, false) })}
        </span>
        <Link to="/welcome" className="text-brand font-semibold hover:underline">
          {t('settings.restartWalkthrough')}
        </Link>
      </div>
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{t('settings.language')}</div>
          <div className="text-xs text-neutral-500">{t('settings.languageHint')}</div>
        </div>
        <LanguageSwitch />
      </div>
    </section>
  )
}
