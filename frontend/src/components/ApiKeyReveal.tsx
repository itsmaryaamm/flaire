import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, KeyRound, Plug } from 'lucide-react'
import { CopyBox } from './CopyBox'
import { Modal } from './Modal'
import { API_URL } from '../lib/api'

export function mcpUrl(apiKey: string) {
  return `${API_URL.replace(/\/$/, '')}/mcp/${apiKey}`
}

/**
 * Shown once after an employee is created or its key is rotated. Leads with how to connect a Claude
 * (Settings, Connect your Claude) and keeps the raw key behind a collapsed Advanced section.
 */
export function ApiKeyReveal({
  apiKey,
  agentName,
  onClose,
  title = 'Employee ready',
}: {
  apiKey: string | null
  agentName?: string
  onClose: () => void
  title?: string
}) {
  const [advanced, setAdvanced] = useState(false)
  useEffect(() => {
    if (apiKey) setAdvanced(false)
  }, [apiKey])

  return (
    <Modal
      open={!!apiKey}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-card border border-brand/30 bg-brand-tint px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Plug className="h-4 w-4 text-brand" />
            Connect this employee to Claude
          </div>
          <p className="text-xs text-neutral-600 mt-1">
            <strong>{agentName ?? 'This employee'}</strong> has its own card and limits. To let a Claude act as it, add Flaire as a connector in
            Claude and sign in with your Flaire account. The steps are under{' '}
            <Link to="/settings#connect" className="text-brand font-semibold hover:underline" onClick={onClose}>
              Settings, Connect your Claude
            </Link>
            .
          </p>
        </div>

        <div className="rounded-card border border-line">
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-neutral-600"
            aria-expanded={advanced}
          >
            {advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <KeyRound className="h-4 w-4 text-brand" />
            Advanced: API key
          </button>
          {advanced && apiKey && (
            <div className="px-3.5 pb-3.5 space-y-3 border-t border-line pt-3">
              <div>
                <div className="label">Raw API key</div>
                <p className="text-xs text-neutral-600 mb-2">
                  For scripts and other agent frameworks. Pass it as <code className="font-mono text-xs bg-lavender-deep px-1 py-0.5 rounded">X-Agent-Key</code>.
                </p>
                <CopyBox value={apiKey} />
              </div>
              <div>
                <div className="label">Direct connector link</div>
                <p className="text-xs text-neutral-600 mb-2">Anyone with this link can act as this employee without signing in. Share with care.</p>
                <CopyBox value={mcpUrl(apiKey)} />
              </div>
              <div className="flex items-start gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2 text-xs text-warn">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Shown once. Flaire stores a hash. Lost it? Rotate the key from the employee page.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
