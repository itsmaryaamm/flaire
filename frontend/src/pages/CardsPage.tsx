import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Snowflake, Sun, Star, PlusCircle, CreditCard, Wifi } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { fromHalalas, sar, toHalalas } from '../lib/money'
import type { Card, CardProvider, Department } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Modal } from '../components/Modal'
import { PROVIDERS, providerInfo } from '../components/ProviderBadge'
import { StatusPill } from '../components/StatusPill'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'

const cardGradient: Record<string, string> = {
  mock_snb: 'from-[#0F5132] to-[#1F7A4A]',
  mock_rajhi: 'from-[#1E3A8A] to-[#2563EB]',
  mock_riyad: 'from-[#4C1D95] to-[#7C3AED]',
  lithic: 'from-[#111411] to-[#3F3F46]',
}

function CardTile({
  card,
  departments,
  onAction,
}: {
  card: Card
  departments: Department[]
  onAction: (action: 'freeze' | 'default' | 'topup', card: Card) => void
}) {
  const info = providerInfo(card.provider)
  const dept = departments.find((d) => d.id === card.department_id)
  const frozen = card.status === 'frozen'
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`relative aspect-[1.586/1] rounded-2xl bg-gradient-to-br ${cardGradient[card.provider] ?? 'from-neutral-700 to-neutral-900'} text-white p-5 flex flex-col justify-between overflow-hidden ${frozen ? 'saturate-50' : ''}`}
      >
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -right-4 bottom-6 h-24 w-24 rounded-full bg-white/5" />
        <div className="flex items-start justify-between relative">
          <div>
            <div className="text-xs text-white/70">{info.bank}</div>
            <div className="font-semibold">{card.label}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {card.is_default && (
              <span className="inline-flex items-center gap-1 rounded-full bg-mint text-brand-dark text-[10px] font-semibold px-2 py-0.5">
                <Star className="h-3 w-3" /> Default
              </span>
            )}
            <Wifi className="h-4 w-4 rotate-90 text-white/70" />
          </div>
        </div>
        <div className="relative">
          <div className="h-7 w-10 rounded-md bg-gradient-to-br from-yellow-200 to-yellow-500 mb-3" />
          <div className="font-mono text-lg tracking-widest tnum">•••• •••• •••• {card.last4}</div>
        </div>
        <div className="flex items-end justify-between relative">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/60">Available</div>
            <div className="font-semibold tnum">{sar(card.available_balance)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-white/60">Limit</div>
            <div className="text-sm tnum">{sar(card.credit_limit)}</div>
          </div>
        </div>
        {frozen && (
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[1px] flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white text-ink text-sm font-semibold px-4 py-1.5">
              <Snowflake className="h-4 w-4 text-sky-600" /> Frozen
            </span>
          </div>
        )}
      </div>
      <div className="card p-3 space-y-2">
        <ProgressBar value={card.credit_limit - card.available_balance} max={card.credit_limit} />
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>{dept ? `Department: ${dept.name}` : 'Company-wide'}</span>
          <StatusPill status={card.status} />
        </div>
        <div className="flex flex-wrap gap-1 pt-1 border-t border-neutral-100">
          <button className="btn-ghost text-xs px-2" onClick={() => onAction('freeze', card)}>
            {frozen ? <Sun className="h-3.5 w-3.5" /> : <Snowflake className="h-3.5 w-3.5" />}
            {frozen ? 'Unfreeze' : 'Freeze'}
          </button>
          {!card.is_default && (
            <button className="btn-ghost text-xs px-2" onClick={() => onAction('default', card)}>
              <Star className="h-3.5 w-3.5" /> Set default
            </button>
          )}
          {card.provider !== 'lithic' && (
            <button className="btn-ghost text-xs px-2" onClick={() => onAction('topup', card)}>
              <PlusCircle className="h-3.5 w-3.5" /> Top up
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddCardForm({ departments, onCancel, onSaved }: { departments: Department[]; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    label: '',
    provider: 'mock_snb' as CardProvider,
    last4: '',
    credit_limit: fromHalalas(1000000),
    department_id: '',
    is_default: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const limit = toHalalas(form.credit_limit)
    if (Number.isNaN(limit) || limit <= 0) {
      setError('Enter a valid credit limit in SAR.')
      return
    }
    if (form.last4 && !/^\d{4}$/.test(form.last4)) {
      setError('Last 4 digits must be exactly four digits.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/cards', {
        label: form.label.trim(),
        provider: form.provider,
        last4: form.last4 || undefined,
        credit_limit: limit,
        department_id: form.department_id ? Number(form.department_id) : null,
        is_default: form.is_default,
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Label</label>
        <input className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="SNB Business" autoFocus />
      </div>
      <div>
        <label className="label">Provider</label>
        <div className="grid sm:grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${form.provider === p.value ? 'border-brand bg-brand-light' : 'border-neutral-300 hover:bg-neutral-50'}`}
            >
              <input type="radio" name="provider" className="accent-brand" checked={form.provider === p.value} onChange={() => setForm({ ...form, provider: p.value })} />
              {p.label}
            </label>
          ))}
        </div>
        {form.provider === 'lithic' && (
          <p className="text-xs text-neutral-500 mt-2">Flaire creates a real sandbox card via Lithic and stores its token. Requires LITHIC_API_KEY on the backend.</p>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Credit limit (SAR)</label>
          <input className="input tnum" inputMode="decimal" required value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
        </div>
        {form.provider !== 'lithic' && (
          <div>
            <label className="label">Last 4 digits (optional)</label>
            <input className="input tnum" inputMode="numeric" maxLength={4} value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })} placeholder="4471" />
          </div>
        )}
        <div>
          <label className="label">Department (optional)</label>
          <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
            <option value="">Company-wide</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm self-end pb-2">
          <input type="checkbox" className="accent-brand" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
          Make this the default card
        </label>
      </div>
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} Add card
        </button>
      </div>
    </form>
  )
}

export default function CardsPage() {
  const toast = useToast()
  const cards = useFetch(() => api.get<Card[]>('/cards').then((r) => r.data), [])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const [addOpen, setAddOpen] = useState(false)
  const [topUp, setTopUp] = useState<Card | null>(null)
  const [topUpAmount, setTopUpAmount] = useState('1000')
  const [topUpError, setTopUpError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const action = async (kind: 'freeze' | 'default' | 'topup', card: Card) => {
    if (kind === 'topup') {
      setTopUp(card)
      setTopUpError(null)
      return
    }
    try {
      if (kind === 'freeze') {
        await api.patch(`/cards/${card.id}`, { status: card.status === 'frozen' ? 'active' : 'frozen' })
        toast.success(card.status === 'frozen' ? `${card.label} unfrozen.` : `${card.label} frozen.`)
      } else {
        await api.patch(`/cards/${card.id}`, { is_default: true })
        toast.success(`${card.label} is now the default card.`)
      }
      await cards.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const doTopUp = async () => {
    if (!topUp) return
    const h = toHalalas(topUpAmount)
    if (Number.isNaN(h) || h <= 0) {
      setTopUpError('Enter a valid SAR amount.')
      return
    }
    setBusy(true)
    setTopUpError(null)
    try {
      await api.post(`/cards/${topUp.id}/top-up`, { amount: h })
      toast.success(`Topped up ${topUp.label} by ${sar(h)}.`)
      setTopUp(null)
      await cards.refetch()
    } catch (err) {
      setTopUpError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const list = cards.data ?? []

  return (
    <div>
      <PageHeader
        title="Cards"
        subtitle="Simulated bank cards, or a Lithic sandbox card. Approved purchases are charged here."
        actions={
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add card
          </button>
        }
      />

      {cards.loading && !cards.data ? (
        <PageLoader />
      ) : cards.error && !cards.data ? (
        <ErrorNote message={cards.error} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CreditCard className="h-5 w-5" />}
            title="No cards yet"
            description="Add a simulated card so approved purchases have something to charge."
            action={
              <button className="btn-primary" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add card
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {list.map((c) => (
            <CardTile key={c.id} card={c} departments={departments.data ?? []} onAction={action} />
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add card">
        <AddCardForm
          departments={departments.data ?? []}
          onCancel={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false)
            toast.success('Card added.')
            void cards.refetch()
          }}
        />
      </Modal>

      <Modal
        open={!!topUp}
        onClose={() => setTopUp(null)}
        title={`Top up ${topUp?.label ?? ''}`}
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setTopUp(null)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={doTopUp} disabled={busy}>
              {busy && <Spinner />} Top up
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">Simulated only. Adds available balance to this mock card.</p>
          <div>
            <label className="label">Amount (SAR)</label>
            <input className="input tnum" inputMode="decimal" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} autoFocus />
          </div>
          <ErrorNote message={topUpError} />
        </div>
      </Modal>
    </div>
  )
}
