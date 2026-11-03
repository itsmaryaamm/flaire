import { KeyRound, AlertTriangle, Sparkles } from 'lucide-react'
import { CopyBox } from './CopyBox'
import { Modal } from './Modal'
import { API_URL } from '../lib/api'

export function mcpUrl(apiKey: string) {
  return `${API_URL.replace(/\/$/, '')}/mcp/${apiKey}`
}

/** Shows a freshly issued agent API key exactly once, with the ready-to-share Claude connector link. */
export function ApiKeyReveal({
  apiKey,
  agentName,
  onClose,
}: {
  apiKey: string | null
  agentName?: string
  onClose: () => void
}) {
  return (
    <Modal
      open={!!apiKey}
      onClose={onClose}
      title="Key issued"
      size="md"
      footer={
        <button className="btn-primary" onClick={onClose}>
          I have saved it
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
            <Sparkles className="h-4 w-4 text-brand" />
            Connect to Claude link
          </div>
          <p className="text-xs text-neutral-600 mt-1 mb-2">
            Send this to anyone. In Claude they go to Settings, Connectors, Add custom connector, paste the
            link, and their Claude becomes <strong>{agentName ?? 'this AI employee'}</strong>. It can check its
            budget and request purchases. It cannot approve anything.
          </p>
          {apiKey && <CopyBox value={mcpUrl(apiKey)} />}
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-900">
            <KeyRound className="h-4 w-4 text-brand" />
            Raw API key
          </div>
          <p className="text-xs text-neutral-600 mt-1 mb-2">
            For scripts and other agent frameworks. Pass it as{' '}
            <code className="font-mono text-xs bg-lavender-deep px-1 py-0.5 rounded">X-Agent-Key</code>.
          </p>
          {apiKey && <CopyBox value={apiKey} />}
        </div>
        <div className="flex items-start gap-2 rounded-input border border-amber-300 bg-warn-tint px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This is the only time the key and link are shown. Flaire stores a hash. Lost it? Rotate the key to
            get a new link; the old one stops working immediately.
          </span>
        </div>
      </div>
    </Modal>
  )
}
