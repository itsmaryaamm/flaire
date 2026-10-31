import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pause, Play, RefreshCw, SlidersHorizontal, Trash2, Bot, ChevronRight } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useFetch, timeAgo } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { sar } from '../lib/money'
import type { Agent, Department } from '../types'
import { PageHeader } from '../components/PageHeader'
import { Modal } from '../components/Modal'
import { AgentForm } from '../components/AgentForm'
import { ApiKeyReveal } from '../components/ApiKeyReveal'
import { StatusPill } from '../components/StatusPill'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState } from '../components/EmptyState'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'

export default function AgentsPage() {
  const toast = useToast()
  const agents = useFetch(() => api.get<Agent[]>('/agents').then((r) => r.data), [])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [deleting, setDeleting] = useState<Agent | null>(null)
  const [rotating, setRotating] = useState<Agent | null>(null)
  const [revealKey, setRevealKey] = useState<{ key: string; name: string } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const toggleStatus = async (a: Agent) => {
    setBusyId(a.id)
    try {
      await api.patch(`/agents/${a.id}`, { status: a.status === 'active' ? 'paused' : 'active' })
      toast.success(a.status === 'active' ? `${a.name} paused.` : `${a.name} resumed.`)
      await agents.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const rotate = async () => {
    if (!rotating) return
    setBusyId(rotating.id)
    try {
      const { data } = await api.post<{ api_key: string }>(`/agents/${rotating.id}/rotate-key`)
      setRevealKey({ key: data.api_key, name: rotating.name })
      setRotating(null)
      await agents.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await api.delete(`/agents/${deleting.id}`)
      toast.success(`${deleting.name} deleted.`)
      setDeleting(null)
      await agents.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const list = agents.data ?? []

  return (
    <div>
      <PageHeader
        title="AI employees"
        subtitle="Each agent gets its own key, limits and approval threshold. None of them can approve anything."
        actions={
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New AI employee
          </button>
        }
      />

      {agents.loading && !agents.data ? (
        <PageLoader />
      ) : agents.error && !agents.data ? (
        <ErrorNote message={agents.error} />
      ) : list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bot className="h-5 w-5" />}
            title="No AI employees yet"
            description="Create one, give it a budget and an approval threshold, and hand it a task."
            action={
              <button className="btn-primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New AI employee
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((a) => (
            <div key={a.id} className="card p-5 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-brand-light text-brand p-2.5 shrink-0">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/agents/${a.id}`} className="font-semibold hover:underline truncate block">
                    {a.name}
                  </Link>
                  <div className="text-xs text-neutral-500 truncate capitalize">
                    {a.role} · {a.department_name}
                  </div>
                </div>
                <StatusPill status={a.status} />
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-neutral-500">Per transaction</dt>
                  <dd className="font-medium tnum">{sar(a.per_transaction_limit)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Approval above</dt>
                  <dd className="font-medium tnum">{sar(a.approval_threshold)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-neutral-500 flex justify-between">
                    <span>Monthly limit</span>
                    <span className="tnum">
                      {sar(a.spent_this_period)} / {sar(a.monthly_limit)}
                    </span>
                  </dt>
                  <dd>
                    <ProgressBar value={a.spent_this_period} max={a.monthly_limit} className="mt-1.5" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Key prefix</dt>
                  <dd className="font-mono text-xs">{a.key_prefix}...</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Last active</dt>
                  <dd className="text-xs">{timeAgo(a.last_active_at)}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-neutral-100 mt-auto">
                <button
                  className="btn-ghost text-xs px-2"
                  onClick={() => toggleStatus(a)}
                  disabled={busyId === a.id}
                  title={a.status === 'active' ? 'Pause' : 'Resume'}
                >
                  {busyId === a.id ? <Spinner className="h-3.5 w-3.5" /> : a.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {a.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button className="btn-ghost text-xs px-2" onClick={() => setEditing(a)}>
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Limits
                </button>
                <button className="btn-ghost text-xs px-2" onClick={() => setRotating(a)}>
                  <RefreshCw className="h-3.5 w-3.5" /> Rotate key
                </button>
                <button className="btn-ghost text-xs px-2 text-red-600 hover:bg-red-50" onClick={() => setDeleting(a)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
                <Link to={`/agents/${a.id}`} className="btn-ghost text-xs px-2 ml-auto text-brand">
                  Console <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New AI employee" size="lg">
        <AgentForm
          departments={departments.data ?? []}
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            void agents.refetch()
          }}
          onCreated={(agent, key) => setRevealKey({ key, name: agent.name })}
        />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit limits: ${editing?.name ?? ''}`} size="lg">
        {editing && (
          <AgentForm
            agent={editing}
            limitsOnly
            departments={departments.data ?? []}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              toast.success('Limits updated.')
              void agents.refetch()
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!rotating}
        onClose={() => setRotating(null)}
        title="Rotate API key?"
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRotating(null)}>Cancel</button>
            <button className="btn-primary" onClick={rotate} disabled={busyId !== null}>
              {busyId !== null && <Spinner />} Rotate key
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          The current key for <strong>{rotating?.name}</strong> stops working immediately. The new key is shown once.
        </p>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete AI employee?"
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn-danger" onClick={remove} disabled={busyId !== null}>
              {busyId !== null && <Spinner />} Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          <strong>{deleting?.name}</strong> will lose access permanently. Past purchase requests stay in the ledger.
        </p>
      </Modal>

      <ApiKeyReveal apiKey={revealKey?.key ?? null} agentName={revealKey?.name} onClose={() => setRevealKey(null)} />
    </div>
  )
}
