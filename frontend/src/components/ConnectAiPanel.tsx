import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { api } from '../lib/api'
import { useFetch } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import { normalizeConnectorInfo } from '../lib/onboarding'
import type { ConnectorDetails } from '../lib/onboarding'
import { CopyBox } from './CopyBox'
import { ErrorNote } from './ErrorNote'
import { Spinner } from './Spinner'

export type AiClient = 'claude' | 'chatgpt'

/** Loads GET /connector-info with translated fallbacks for fields an older backend does not return. */
export function useConnectorDetails() {
  const t = useT()
  return useFetch<ConnectorDetails>(
    () =>
      api.get('/connector-info').then((r) =>
        normalizeConnectorInfo(r.data, {
          claude: [t('connect.claude1'), t('connect.claude2'), t('connect.claude3'), t('connect.claude4'), t('connect.claude5'), t('connect.claude6'), t('connect.claude7')],
          chatgpt: [t('connect.gpt1'), t('connect.gpt2'), t('connect.gpt3'), t('connect.gpt4'), t('connect.gpt5'), t('connect.gpt6'), t('connect.gpt7')],
          instructions: t('connect.defaultInstructions'),
        }),
      ),
    [],
  )
}

/** Multi-line text with a copy button (CopyBox is single line). */
function CopyBlock({ value }: { value: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }
  return (
    <div className="relative">
      <pre dir="ltr" className="whitespace-pre-wrap break-words text-start rounded-input border border-line-strong bg-lavender px-3 py-2 pe-24 text-xs leading-relaxed font-sans text-ink max-h-56 overflow-auto">
        {value}
      </pre>
      <button type="button" onClick={copy} className="btn-secondary absolute top-2 end-2 text-xs py-1 px-3" aria-label={t('common.copy')}>
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  )
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2 text-sm text-neutral-600">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-bold tnum">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * "Connect your AI": Claude | ChatGPT tabs with the MCP URL, numbered steps and the agent instructions.
 * Shared by the setup wizard and the settings card.
 */
export function ConnectAiPanel({ className = '' }: { className?: string }) {
  const t = useT()
  const info = useConnectorDetails()
  const [tab, setTab] = useState<AiClient>('claude')

  if (info.loading && !info.data) {
    return (
      <div className={`flex items-center gap-2 text-sm text-neutral-500 py-2 ${className}`}>
        <Spinner /> {t('settings.loadingConnector')}
      </div>
    )
  }
  if (info.error && !info.data) return <ErrorNote message={info.error} className={className} />
  const d = info.data
  if (!d) return null

  const tabBtn = (value: AiClient, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`flex-1 rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${tab === value ? 'bg-white text-brand shadow-card' : 'text-neutral-600 hover:text-ink'}`}
    >
      {label}
    </button>
  )

  return (
    <div className={`space-y-4 ${className}`}>
      <div role="tablist" className="flex rounded-pill border border-line bg-lavender p-1">
        {tabBtn('claude', 'Claude')}
        {tabBtn('chatgpt', 'ChatGPT')}
      </div>

      <div>
        <div className="label">{t('connect.mcpUrl')}</div>
        <CopyBox value={d.mcp_url} />
      </div>

      {tab === 'claude' ? (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">{t('connect.claudeIntro')}</p>
          <Steps steps={d.claude_steps} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500">{t('connect.chatgptIntro')}</p>
          <Steps steps={d.chatgpt_steps} />
        </div>
      )}

      <div>
        <div className="label">{t('connect.agentInstructions')}</div>
        <p className="text-xs text-neutral-500 mb-1.5">{t('connect.agentInstructionsHint')}</p>
        <CopyBlock value={d.agent_instructions} />
      </div>
    </div>
  )
}
