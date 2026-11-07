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

/** Settings card: company name and the walkthrough link. */
export function CompanyCard() {
  const { company, setCompany } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(company?.name ?? '')
  const [saving, setSaving] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.patch<Company>('/company', { name: name.trim() })
      setCompany(data)
      toast.success('Company name updated.')
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
        <h3 className="font-bold">Company</h3>
      </div>
      <form onSubmit={save} className="mt-3 flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="company-name">Company name</label>
          <input id="company-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary self-end" disabled={saving || name.trim() === company?.name}>
          {saving && <Spinner />} Save
        </button>
      </form>
      <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>
          {company?.currency ?? 'SAR'} · since {formatDate(company?.created_at, false)}
        </span>
        <Link to="/welcome" className="text-brand font-semibold hover:underline">
          Restart the walkthrough
        </Link>
      </div>
    </section>
  )
}
