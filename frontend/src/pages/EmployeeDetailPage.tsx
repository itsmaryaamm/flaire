import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import type { Agent, Department } from '../types'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { Modal } from '../components/Modal'
import { ApiKeyReveal } from '../components/ApiKeyReveal'
import { EmployeeChat } from '../components/employees/EmployeeChat'
import { AdvancedSection, CardAndLimits, ConnectedClaudes, ProfileCard } from '../components/employees/EmployeeSidebar'

/** One employee: profile, card, limits and connections on the left; chat on the right. Stacked on phones. */
export default function EmployeeDetailPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const agentId = Number(id)

  const agent = useFetch(() => api.get<Agent>(`/agents/${agentId}`).then((r) => r.data), [agentId])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  // "Chat" from the grid scrolls to the chat on phones.
  useEffect(() => {
    if (search.get('chat') === '1' && agent.data && chatRef.current && window.innerWidth < 1024) {
      chatRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [search, agent.data])

  const a = agent.data

  const remove = async () => {
    if (!a) return
    setBusy(true)
    try {
      await api.delete(`/agents/${a.id}`)
      toast.success(`${a.name} deleted.`)
      navigate('/employees', { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(false)
    }
  }

  if (agent.loading && !a) return <PageLoader />
  if (agent.error && !a)
    return (
      <div className="space-y-3">
        <ErrorNote message={agent.error} />
        <Link to="/employees" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to employees
        </Link>
      </div>
    )
  if (!a) return null

  const refresh = () => void agent.refetch()

  return (
    <div className="space-y-4">
      <Link to="/employees" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-brand font-medium">
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>

      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          <ProfileCard agent={a} onChanged={refresh} onDelete={() => setDeleting(true)} />
          <CardAndLimits agent={a} departments={departments.data ?? []} onChanged={refresh} />
          <ConnectedClaudes agentId={a.id} />
          <AdvancedSection
            agent={a}
            onRotated={(key) => {
              setRevealKey(key)
              refresh()
            }}
          />
        </div>
        <div ref={chatRef} className="min-w-0 scroll-mt-16">
          <EmployeeChat agent={a} onChanged={refresh} />
        </div>
      </div>

      <ApiKeyReveal apiKey={revealKey} agentName={a.name} title="Key rotated" onClose={() => setRevealKey(null)} />

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete employee?"
        size="sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setDeleting(false)} disabled={busy}>
              Cancel
            </button>
            <button className="btn-danger" onClick={remove} disabled={busy}>
              {busy && <Spinner />} Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          <strong>{a.name}</strong> loses access permanently and its card is closed. Past requests stay in the ledger.
        </p>
      </Modal>
    </div>
  )
}
