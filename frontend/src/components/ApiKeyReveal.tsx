import { KeyRound, AlertTriangle } from 'lucide-react'
import { CopyBox } from './CopyBox'
import { Modal } from './Modal'

/** Shows a freshly issued agent API key exactly once. */
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
      title="API key issued"
      size="sm"
      footer={
        <button className="btn-primary" onClick={onClose}>
          I have saved it
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <KeyRound className="h-4 w-4 text-brand" />
          <span>
            Key for <strong>{agentName ?? 'this AI employee'}</strong>. Pass it as{' '}
            <code className="font-mono text-xs bg-neutral-100 px-1 py-0.5 rounded">X-Agent-Key</code>.
          </span>
        </div>
        {apiKey && <CopyBox value={apiKey} />}
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This is the only time the full key is shown. Flaire stores a hash. If you lose it, rotate
            the key to get a new one.
          </span>
        </div>
      </div>
    </Modal>
  )
}
