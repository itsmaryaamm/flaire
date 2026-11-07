import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { History, MessageSquarePlus, Send } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch, formatDate } from '../../lib/useFetch'
import { sar } from '../../lib/money'
import type { Agent, PurchaseRequest, RunOut, TranscriptEntry } from '../../types'
import { Transcript } from '../Transcript'
import { StatusPill } from '../StatusPill'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'
import { ReasonsList } from '../DecisionDetails'

const SUGGESTIONS = [
  'Launch a SAR 300 Google Ads test in Riyadh',
  'What have you bought this month?',
  'Plan a two-week Snapchat campaign, SAR 950',
]

function CreatedRequests({ items }: { items: PurchaseRequest[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="mono-label">Purchase requests in this conversation</div>
      {items.map((pr) => (
        <div key={pr.id} className="rounded-card border border-line bg-white px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{pr.merchant}</span>
            <span className="text-xs text-neutral-500">{pr.category}</span>
            <span className="text-sm font-semibold tnum ml-auto">{sar(pr.amount)}</span>
            <StatusPill status={pr.status} />
          </div>
          {pr.description && <p className="text-xs text-neutral-600 mt-1.5">{pr.description}</p>}
          <ReasonsList decision={pr.decision} className="mt-2" />
        </div>
      ))}
    </div>
  )
}

/** "Talk to {name}": a chat over POST /agents/:id/chat with threads from GET /agents/:id/runs. */
export function EmployeeChat({ agent, onChanged }: { agent: Agent; onChanged?: () => void }) {
  const runs = useFetch(() => api.get<RunOut[]>(`/agents/${agent.id}/runs`).then((r) => r.data), [agent.id])
  const [runId, setRunId] = useState<number | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [mode, setMode] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, busy])

  const threads = useMemo(() => runs.data ?? [], [runs.data])

  const openThread = (id: number | null) => {
    setRunId(id)
    setError(null)
    if (id === null) {
      setEntries([])
      setRequests([])
      setMode(null)
      return
    }
    const run = threads.find((t) => t.run_id === id)
    setEntries(run?.transcript ?? [])
    setRequests(run?.purchase_requests ?? [])
    setMode(run?.mode ?? null)
  }

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setError(null)
    setEntries((e) => [...e, { role: 'user', content: message }])
    setInput('')
    setBusy(true)
    try {
      const { data } = await api.post<RunOut>(`/agents/${agent.id}/chat`, { message, run_id: runId ?? undefined }, { timeout: 90_000 })
      setRunId(data.run_id)
      setEntries(data.transcript ?? [])
      setRequests(data.purchase_requests ?? [])
      setMode(data.mode)
      void runs.refetch()
      onChanged?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const empty = entries.length === 0 && !busy

  return (
    <section className="card-lg flex flex-col lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:max-h-[860px]">
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate">Talk to {agent.name}</h2>
            {mode === 'scripted' && <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400 mt-0.5">basic mode</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {threads.length > 0 && (
              <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                <History className="h-3.5 w-3.5" />
                <select
                  className="input h-8 py-0 text-xs w-auto max-w-[160px]"
                  value={runId ?? ''}
                  onChange={(e) => openThread(e.target.value ? Number(e.target.value) : null)}
                  aria-label="Previous conversations"
                >
                  <option value="">Previous conversations</option>
                  {threads.map((t) => (
                    <option key={t.run_id} value={t.run_id}>
                      {formatDate(t.created_at)} · {(t.task || 'Conversation').slice(0, 40)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="btn-ghost text-xs px-2" onClick={() => openThread(null)} disabled={runId === null && entries.length === 0}>
              <MessageSquarePlus className="h-3.5 w-3.5" /> New
            </button>
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 lg:overflow-y-auto px-4 py-4 space-y-4 bg-lavender/40">
        {empty && (
          <div className="text-sm text-neutral-600">
            <p>
              Give {agent.name} a task in plain language. It checks its budget, asks Flaire for purchases, and Flaire decides. You approve anything
              above {sar(agent.approval_threshold)}.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-pill border border-line-strong bg-white px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.length > 0 && <Transcript entries={entries} assistantLabel={agent.name} />}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-card rounded-bl-md bg-white border border-line px-3.5 py-2.5 text-sm text-neutral-500 inline-flex items-center gap-2">
              <Spinner className="h-3.5 w-3.5" /> Thinking...
            </div>
          </div>
        )}
        {!busy && <CreatedRequests items={requests} />}
        <ErrorNote message={error} />
      </div>

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void send(input)
        }}
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:static bg-white border-t border-line px-3 py-3 rounded-b-card-lg flex gap-2"
      >
        <input
          className="input h-11 flex-1"
          placeholder={agent.status === 'paused' ? `${agent.name} is paused; purchases will be blocked` : `Message ${agent.name}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn-primary h-11 w-11 p-0 shrink-0" disabled={busy || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  )
}
