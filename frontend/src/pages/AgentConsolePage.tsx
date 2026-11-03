import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bot, Pause, Play, Send, Sparkles, TerminalSquare, History, SlidersHorizontal, RefreshCw } from 'lucide-react'
import { api, API_URL, errorMessage } from '../lib/api'
import { useFetch, formatDate, timeAgo } from '../lib/useFetch'
import { useToast } from '../lib/toast'
import { sar } from '../lib/money'
import type { Agent, AgentRun, Department } from '../types'
import { StatusPill } from '../components/StatusPill'
import { Money } from '../components/Money'
import { ProgressBar } from '../components/ProgressBar'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { Modal } from '../components/Modal'
import { AgentForm } from '../components/AgentForm'
import { ApiKeyReveal } from '../components/ApiKeyReveal'
import { Transcript } from '../components/Transcript'
import { ReasonsList } from '../components/DecisionDetails'
import { CopyBox } from '../components/CopyBox'
import { EmptyState } from '../components/EmptyState'

const EXAMPLES = [
  'Set up a Google Ads campaign for the Ramadan launch, budget around SAR 500',
  'Buy a Canva subscription for about SAR 200',
  'Buy SAR 4,950 of gift cards for the team',
  'Buy campaign tools for SAR 1,800',
]

function ModeBadge({ mode }: { mode: AgentRun['mode'] }) {
  return mode === 'claude' ? (
    <span className="inline-flex items-center gap-1 rounded-pill bg-brand text-white text-[11px] font-semibold px-2 py-0.5">
      <Sparkles className="h-3 w-3" /> Real Claude
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-pill bg-lavender-deep text-neutral-600 text-[11px] font-semibold px-2 py-0.5">
      Scripted (no API key)
    </span>
  )
}

function RunResult({ run }: { run: AgentRun }) {
  return (
    <div className="space-y-5">
      <Transcript entries={run.transcript ?? []} />
      <div>
        <h4 className="mono-label mb-2">Purchase requests created by this run</h4>
        {(run.purchase_requests ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No purchase requests were created.</p>
        ) : (
          <ul className="space-y-2">
            {run.purchase_requests.map((pr) => (
              <li key={pr.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-semibold text-sm">{pr.merchant}</span>
                  <span className="text-xs text-neutral-500">{pr.category}</span>
                  <Money halalas={pr.amount} className="text-sm font-semibold ml-auto" />
                  <StatusPill status={pr.status} />
                </div>
                {pr.description && <p className="text-xs text-neutral-600 mb-2">{pr.description}</p>}
                <ReasonsList decision={pr.decision} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function AgentConsolePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const agentId = Number(id)

  const agent = useFetch(() => api.get<Agent>(`/agents/${agentId}`).then((r) => r.data), [agentId])
  const departments = useFetch(() => api.get<Department[]>('/departments').then((r) => r.data), [])
  const runs = useFetch(() => api.get<AgentRun[]>(`/agents/${agentId}/runs`).then((r) => r.data), [agentId])

  const [task, setTask] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [result, setResult] = useState<AgentRun | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openRun, setOpenRun] = useState<number | null>(null)

  const a = agent.data

  const run = async () => {
    if (!task.trim() || !a) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const { data } = await api.post<AgentRun>(`/agents/${a.id}/run`, { task: task.trim() }, { timeout: 90_000 })
      setResult(data)
      await Promise.all([runs.refetch(), agent.refetch()])
    } catch (err) {
      setRunError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  const toggleStatus = async () => {
    if (!a) return
    setBusy(true)
    try {
      await api.patch(`/agents/${a.id}`, { status: a.status === 'active' ? 'paused' : 'active' })
      await agent.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (skipConfirm = false) => {
    if (!a) return
    if (!skipConfirm && !window.confirm('Rotate the API key? The current key stops working immediately.')) return
    setBusy(true)
    try {
      const { data } = await api.post<{ api_key: string }>(`/agents/${a.id}/rotate-key`)
      setRevealKey(data.api_key)
      await agent.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (agent.loading && !a) return <PageLoader />
  if (agent.error && !a)
    return (
      <div className="space-y-3">
        <ErrorNote message={agent.error} />
        <button className="btn-secondary" onClick={() => navigate('/agents')}>
          <ArrowLeft className="h-4 w-4" /> Back to AI employees
        </button>
      </div>
    )
  if (!a) return null

  const curl = `curl -X POST ${API_URL}/agent/purchase-requests \\
  -H "X-Agent-Key: ${a.key_prefix}_REPLACE_WITH_FULL_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 50000, "merchant": "Google Ads", "category": "advertising", "description": "Ramadan launch campaign"}'`

  return (
    <div className="space-y-6">
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-brand font-medium">
        <ArrowLeft className="h-4 w-4" /> AI employees
      </Link>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left: details + limits */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-lg p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand-light text-brand p-2.5 shrink-0">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold truncate">{a.name}</h1>
                <div className="text-sm text-neutral-500 capitalize">
                  {a.role} · {a.department_name}
                </div>
              </div>
              <StatusPill status={a.status} />
            </div>

            <dl className="mt-5 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-500 flex justify-between">
                  <span>Monthly limit</span>
                  <span className="tnum">
                    {sar(a.spent_this_period)} / {sar(a.monthly_limit)}
                  </span>
                </dt>
                <dd>
                  <ProgressBar value={a.spent_this_period} max={a.monthly_limit} className="mt-1.5" thin />
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-neutral-500">Per transaction</dt>
                  <dd className="font-medium tnum">{sar(a.per_transaction_limit)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Approval above</dt>
                  <dd className="font-medium tnum">{sar(a.approval_threshold)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Requests per hour</dt>
                  <dd className="font-medium tnum">{a.max_requests_per_hour}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Last active</dt>
                  <dd className="font-medium">{timeAgo(a.last_active_at)}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 mb-1">Allowed categories</dt>
                <dd className="flex flex-wrap gap-1">
                  {a.allowed_categories.length === 0 ? (
                    <span className="text-neutral-400 text-xs">any</span>
                  ) : (
                    a.allowed_categories.map((c) => (
                      <span key={c} className="rounded-pill bg-brand-light text-brand text-xs font-semibold px-2 py-0.5">
                        {c}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 mb-1">Blocked merchants</dt>
                <dd className="flex flex-wrap gap-1">
                  {a.blocked_merchants.length === 0 ? (
                    <span className="text-neutral-400 text-xs">none</span>
                  ) : (
                    a.blocked_merchants.map((c) => (
                      <span key={c} className="rounded-pill bg-danger-tint text-danger text-xs font-semibold px-2 py-0.5">
                        {c}
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">API key</dt>
                <dd className="font-mono text-xs">{a.key_prefix}... (hash stored)</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-line">
              <button className="btn-secondary text-xs" onClick={() => setEditOpen(true)}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> Edit limits
              </button>
              <button className="btn-secondary text-xs" onClick={toggleStatus} disabled={busy}>
                {a.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {a.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button className="btn-secondary text-xs" onClick={() => rotate()} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" /> Rotate key
              </button>
            </div>
          </div>

          <div className="card-lg p-5 border-brand/40 bg-brand-tint">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-brand" />
              <h3 className="font-bold text-sm">Use this AI employee from any Claude</h3>
            </div>
            <p className="text-xs text-neutral-600 mb-3">
              Flaire is an MCP connector. Share one link and the recipient's own Claude becomes{' '}
              <strong>{a.name}</strong>: it can check its budget and request purchases through Flaire, and nothing
              more. Approvals stay here, with you.
            </p>
            <ol className="text-xs text-neutral-700 space-y-1 mb-3 list-decimal list-inside">
              <li>Click <strong>Get connect link</strong> (this rotates the key, so the old link stops working).</li>
              <li>Send the link. They open Claude, Settings, Connectors, Add custom connector, paste it.</li>
              <li>They ask their Claude: "Set up a Google Ads campaign for about SAR 500." You see it here.</li>
            </ol>
            <button className="btn-primary text-xs" onClick={() => rotate(true)} disabled={busy}>
              Get connect link
            </button>
            <p className="text-[11px] text-neutral-500 mt-2 font-mono break-all">
              {API_URL.replace(/\/$/, '')}/mcp/{a.key_prefix}...
            </p>
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <TerminalSquare className="h-4 w-4 text-brand" />
              <h3 className="font-bold text-sm">Call the API as this agent</h3>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              Agents authenticate with <code className="font-mono">X-Agent-Key</code> and can only reach{' '}
              <code className="font-mono">/agent/*</code>. They receive a decision; they cannot approve, override or
              see other agents.
            </p>
            <pre className="text-[11px] font-mono bg-brand-deep text-white/90 rounded-card p-3 overflow-x-auto whitespace-pre">
              {curl}
            </pre>
            <div className="mt-2">
              <CopyBox value={curl.replace(/\\\n\s*/g, '')} />
            </div>
          </div>
        </div>

        {/* Right: task runner */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card-lg p-5">
            <h3 className="font-bold">Give this AI employee a task</h3>
            <p className="text-xs text-neutral-500 mt-0.5 mb-3">
              The agent plans the task and asks Flaire for purchases. Flaire decides. Try one that should pass, one
              that needs approval and one that should be blocked.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setTask(ex)}
                  className="rounded-pill border border-line-strong bg-white px-3 py-1 text-xs font-medium hover:border-brand hover:text-brand text-left"
                >
                  {ex}
                </button>
              ))}
            </div>
            <textarea
              className="input min-h-[96px] resize-y"
              placeholder="Describe the task in plain language..."
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={running}
            />
            <div className="flex items-center justify-between mt-3 gap-3">
              <span className="text-xs text-neutral-400">
                {a.status === 'paused' ? 'This agent is paused; requests will be denied.' : 'Runs can take up to 30 seconds.'}
              </span>
              <button className="btn-primary" onClick={run} disabled={running || !task.trim()}>
                {running ? <Spinner /> : <Send className="h-4 w-4" />}
                {running ? 'Working...' : 'Run task'}
              </button>
            </div>
            <ErrorNote message={runError} className="mt-3" />
          </div>

          {running && (
            <div className="card-lg p-6 flex flex-col items-center text-center gap-2">
              <Spinner className="h-6 w-6 text-brand" />
              <div className="text-sm font-semibold">The AI employee is working on it</div>
              <div className="text-xs text-neutral-500">
                Planning the task, calling request_purchase, and waiting for Flaire's decision. Up to 30 seconds.
              </div>
            </div>
          )}

          {result && !running && (
            <div className="card p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="font-bold">Run #{result.run_id ?? result.id}</h3>
                <ModeBadge mode={result.mode} />
              </div>
              <RunResult run={result} />
            </div>
          )}

          <div className="card-lg overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-line">
              <History className="h-4 w-4 text-neutral-500" />
              <h3 className="font-bold text-sm">Previous runs</h3>
              <span className="font-mono text-xs text-neutral-400 ml-auto tnum">{runs.data?.length ?? 0}</span>
            </div>
            {runs.loading && !runs.data ? (
              <PageLoader />
            ) : (runs.data ?? []).length === 0 ? (
              <EmptyState compact title="No runs yet" description="Run a task above to see the transcript here." />
            ) : (
              <ul className="divide-y divide-line">
                {[...(runs.data ?? [])].reverse().map((r, idx) => {
                  const key = r.run_id ?? r.id ?? idx
                  const open = openRun === key
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-lavender"
                        onClick={() => setOpenRun(open ? null : key)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{r.task || `Run #${key}`}</div>
                          <div className="text-xs text-neutral-500">
                            {r.created_at ? formatDate(r.created_at) : ''} · {(r.purchase_requests ?? []).length} request(s)
                          </div>
                        </div>
                        <ModeBadge mode={r.mode} />
                      </button>
                      {open && (
                        <div className="px-5 pb-5">
                          <RunResult run={r} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit limits: ${a.name}`} size="lg">
        <AgentForm
          agent={a}
          limitsOnly
          departments={departments.data ?? []}
          onCancel={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            toast.success('Limits updated.')
            void agent.refetch()
          }}
        />
      </Modal>
      <ApiKeyReveal apiKey={revealKey} agentName={a.name} onClose={() => setRevealKey(null)} />
    </div>
  )
}
