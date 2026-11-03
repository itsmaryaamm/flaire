import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyBox({ value, mono = true }: { value: string; mono?: boolean }) {
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
    <div className="flex items-stretch gap-2">
      <code
        className={`flex-1 min-w-0 break-all rounded-input border border-line-strong bg-lavender px-3 py-2 text-sm ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </code>
      <button type="button" onClick={copy} className="btn-secondary shrink-0" aria-label="Copy">
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}
