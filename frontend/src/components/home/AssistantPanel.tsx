import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { sar } from '../../lib/money'
import type { AssistantDecisionAction, AssistantResponse, ChatTurn, PurchaseRequest } from '../../types'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'

const SUGGESTIONS = ['What needs me?', 'What did we spend this week?', 'Why was the last request held?']

type Bubble =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'system'; text: string }
  | { id: number; kind: 'action'; action: AssistantDecisionAction; done?: string }

let seq = 0
const next = () => ++seq

function isDecision(a: unknown): a is AssistantDecisionAction {
  return !!a && typeof a === 'object' && (a as { type?: unknown }).type === 'decision'
}

/** Inline confirmation for a decision the assistant prepared. */
function ActionCard({ bubble, onConfirmed }: { bubble: Extract<Bubble, { kind: 'action' }>; onConfirmed: (text: string, result: PurchaseRequest | null) => void }) {
  const { company } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const a = bubble.action
  const needsPassword = company?.require_password_on_approve ?? true
  const verb = a.action === 'approve' ? 'Approve' : 'Decline'

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<PurchaseRequest>(`/approvals/${a.request_id}/${a.action}`, {
        note: a.note || undefined,
        password: password || undefined,
      })
      const text =
        data.needs_second_approver && data.status === 'pending_approval'
          ? `First approval recorded for ${data.merchant}. A second approver must confirm.`
          : a.action === 'approve'
            ? data.status === 'completed'
              ? `Approved and paid: ${data.merchant} ${sar(data.amount)}.`
              : `Approved ${data.merchant}. Payment status: ${data.status}.`
            : `Declined ${data.merchant} ${sar(data.amount)}.`
      onConfirmed(text, data)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-card border px-3.5 py-3 text-sm ${a.action === 'approve' ? 'border-success/40 bg-success-tint/40' : 'border-line-strong bg-lavender'}`}>
      <div className="font-semibold">
        {verb} {a.merchant} {sar(a.amount)} from {a.agent}
      </div>
      {bubble.done ? (
        <div className="text-xs text-neutral-500 mt-1">{bubble.done}</div>
      ) : (
        <form onSubmit={confirm} className="mt-2.5 flex gap-2">
          <input
            className="input h-10 flex-1"
            type="password"
            autoComplete="current-password"
            placeholder={needsPassword ? 'Your password' : 'Password (optional)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className={`${a.action === 'approve' ? 'btn-success' : 'btn-secondary'} h-10 shrink-0`} disabled={busy || (needsPassword && !password)}>
            {busy ? <Spinner /> : null} Confirm
          </button>
        </form>
      )}
      <ErrorNote message={error} className="mt-2" />
    </div>
  )
}

/** The company assistant: a chat over POST /assistant/chat with inline decision confirmation. */
export function AssistantPanel({ onDecided }: { onDecided: (result: PurchaseRequest) => void }) {
  const { user } = useAuth()
  const firstName = (user?.full_name ?? '').trim().split(/\s+/)[0] || ''
  const [bubbles, setBubbles] = useState<Bubble[]>(() => [
    { id: next(), kind: 'assistant', text: `Hi${firstName ? ` ${firstName}` : ''}. I can tell you what needs you, what was spent, and why a request was held. Ask me anything.` },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [bubbles, busy])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setError(null)
    const history: ChatTurn[] = bubbles
      .filter((b): b is Extract<Bubble, { kind: 'user' | 'assistant' }> => b.kind === 'user' || b.kind === 'assistant')
      .slice(-10)
      .map((b) => ({ role: b.kind, content: b.text }))
    setBubbles((b) => [...b, { id: next(), kind: 'user', text: message }])
    setInput('')
    setBusy(true)
    try {
      const { data } = await api.post<AssistantResponse>('/assistant/chat', { message, history }, { timeout: 90_000 })
      setMode(data.mode)
      const additions: Bubble[] = [{ id: next(), kind: 'assistant', text: data.reply }]
      for (const a of data.actions ?? []) if (isDecision(a)) additions.push({ id: next(), kind: 'action', action: a })
      setBubbles((b) => [...b, ...additions])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const showChips = bubbles.length === 1

  return (
    <section className="card-lg flex flex-col lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)] lg:max-h-[820px]">
      <div className="px-4 pt-4 pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-bold">Assistant</h2>
        </div>
        {mode === 'scripted' && <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-400 mt-1">basic mode</div>}
      </div>

      <div ref={listRef} className="flex-1 lg:overflow-y-auto px-4 py-4 space-y-3">
        {bubbles.map((b) => {
          if (b.kind === 'user')
            return (
              <div key={b.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-card rounded-br-md bg-brand text-white px-3.5 py-2.5 text-sm whitespace-pre-wrap">{b.text}</div>
              </div>
            )
          if (b.kind === 'assistant')
            return (
              <div key={b.id} className="flex justify-start">
                <div className="max-w-[90%] rounded-card rounded-bl-md bg-lavender px-3.5 py-2.5 text-sm whitespace-pre-wrap">{b.text}</div>
              </div>
            )
          if (b.kind === 'system')
            return (
              <div key={b.id} className="text-center font-mono text-[11px] text-neutral-500 px-2">
                {b.text}
              </div>
            )
          return (
            <ActionCard
              key={b.id}
              bubble={b}
              onConfirmed={(text, result) => {
                setBubbles((list) => [...list.map((x) => (x.id === b.id ? { ...x, done: 'Confirmed.' } : x)), { id: next(), kind: 'system', text }])
                if (result) onDecided(result)
              }}
            />
          )
        })}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-card rounded-bl-md bg-lavender px-3.5 py-2.5 text-sm text-neutral-500 inline-flex items-center gap-2">
              <Spinner className="h-3.5 w-3.5" /> Thinking...
            </div>
          </div>
        )}
        {showChips && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="rounded-pill border border-line-strong bg-white px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <ErrorNote message={error} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:static bg-white border-t border-line px-3 py-3 rounded-b-card-lg flex gap-2"
      >
        <input
          className="input h-11 flex-1"
          placeholder="Ask about spending, holds or employees"
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
