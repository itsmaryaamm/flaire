import { useState } from 'react'
import { ChevronDown, ChevronRight, Wrench, User, Bot } from 'lucide-react'
import type { TranscriptEntry } from '../types'
import { StatusPill } from './StatusPill'

/** Normalised transcript item we can render. */
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; input: unknown; output: unknown; status?: string | null }
  | { kind: 'system'; text: string }

function asText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v
      .map((b) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object' && 'text' in b) return String((b as { text: unknown }).text ?? '')
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text ?? '')
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const s = v.trim()
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s)
    } catch {
      return v
    }
  }
  return v
}

function findStatus(output: unknown): string | null {
  const o = parseMaybeJson(output)
  if (o && typeof o === 'object') {
    const obj = o as Record<string, unknown>
    if (typeof obj.status === 'string') return obj.status
    if (typeof obj.verdict === 'string') return obj.verdict
    const dec = obj.decision as Record<string, unknown> | undefined
    if (dec && typeof dec.verdict === 'string') return dec.verdict
    const pr = obj.purchase_request as Record<string, unknown> | undefined
    if (pr && typeof pr.status === 'string') return pr.status
  }
  return null
}

/**
 * Turns the backend transcript into renderable items. Handles three shapes:
 *  1. Anthropic messages: assistant content with tool_use blocks, user content with tool_result blocks.
 *  2. Flat entries with role "tool_use" / "tool_result" / "tool".
 *  3. Plain {role, content: string}.
 */
export function normaliseTranscript(entries: TranscriptEntry[]): Item[] {
  const items: Item[] = []
  const pendingTools = new Map<string, number>() // tool_use id -> index in items

  for (const e of entries) {
    const role = String(e.role ?? '')
    const content = e.content

    // Flat tool-call entries
    if (role === 'tool_use' || role === 'tool_call' || role === 'tool') {
      const inputVal = e.input ?? (content && typeof content === 'object' && 'input' in (content as object) ? (content as { input: unknown }).input : content)
      const outputVal = e.output ?? e.result ?? (content && typeof content === 'object' && 'output' in (content as object) ? (content as { output: unknown }).output : undefined)
      items.push({
        kind: 'tool',
        name: String(e.name ?? e.tool_name ?? e.tool ?? 'tool'),
        input: inputVal,
        output: outputVal,
        status: findStatus(outputVal),
      })
      continue
    }
    if (role === 'tool_result') {
      const last = [...items].reverse().find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }> | undefined
      if (last && last.output === undefined) {
        last.output = content
        last.status = findStatus(content)
      } else {
        items.push({ kind: 'tool', name: String(e.name ?? e.tool_name ?? 'tool result'), input: undefined, output: content, status: findStatus(content) })
      }
      continue
    }

    // Anthropic-style content blocks
    if (Array.isArray(content)) {
      const textParts: string[] = []
      for (const block of content as Array<Record<string, unknown>>) {
        if (!block || typeof block !== 'object') continue
        const type = block.type
        if (type === 'text') {
          textParts.push(String(block.text ?? ''))
        } else if (type === 'tool_use') {
          const idx = items.push({ kind: 'tool', name: String(block.name ?? 'tool'), input: block.input, output: undefined }) - 1
          if (typeof block.id === 'string') pendingTools.set(block.id, idx)
        } else if (type === 'tool_result') {
          const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
          const idx = id ? pendingTools.get(id) : undefined
          const out = block.content
          if (idx !== undefined) {
            const t = items[idx] as Extract<Item, { kind: 'tool' }>
            t.output = out
            t.status = findStatus(asText(out))
          } else {
            items.push({ kind: 'tool', name: 'tool result', input: undefined, output: out, status: findStatus(asText(out)) })
          }
        }
      }
      const text = textParts.join('\n').trim()
      if (text) items.push({ kind: role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant', text })
      continue
    }

    const text = asText(content).trim()
    if (!text) continue
    if (role === 'user') items.push({ kind: 'user', text })
    else if (role === 'system') items.push({ kind: 'system', text })
    else items.push({ kind: 'assistant', text })
  }
  return items
}

function Json({ value }: { value: unknown }) {
  const v = parseMaybeJson(value)
  const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return (
    <pre className="text-xs font-mono bg-lavender border border-line rounded-input p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-64">
      {text}
    </pre>
  )
}

function ToolCard({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-input border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
        <Wrench className="h-4 w-4 text-brand" />
        <span className="font-mono text-xs font-medium">{item.name}</span>
        {item.status && <StatusPill status={item.status} className="ml-auto" />}
        {!item.status && item.output === undefined && (
          <span className="ml-auto text-xs text-neutral-400">no result</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-line pt-2">
          <div>
            <div className="mono-label mb-1">Input</div>
            <Json value={item.input ?? {}} />
          </div>
          <div>
            <div className="mono-label mb-1">Output</div>
            <Json value={item.output ?? null} />
          </div>
        </div>
      )}
    </div>
  )
}

export function Transcript({ entries, assistantLabel = 'AI employee' }: { entries: TranscriptEntry[]; assistantLabel?: string }) {
  const items = normaliseTranscript(entries)
  if (items.length === 0) return <p className="text-sm text-neutral-500">Empty transcript.</p>
  return (
    <div className="space-y-3">
      {items.map((it, i) => {
        if (it.kind === 'user')
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-card rounded-br-md bg-brand text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/70 mb-1">
                  <User className="h-3 w-3" /> You
                </div>
                {it.text}
              </div>
            </div>
          )
        if (it.kind === 'assistant')
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] rounded-card rounded-bl-md bg-white border border-line px-4 py-2.5 text-sm whitespace-pre-wrap">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
                  <Bot className="h-3 w-3" /> {assistantLabel}
                </div>
                {it.text}
              </div>
            </div>
          )
        if (it.kind === 'system')
          return (
            <div key={i} className="text-center text-xs text-neutral-400 italic">
              {it.text}
            </div>
          )
        return (
          <div key={i} className="pl-0 sm:pl-6">
            <ToolCard item={it} />
          </div>
        )
      })}
    </div>
  )
}
