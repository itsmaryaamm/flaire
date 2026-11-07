import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useT } from '../lib/i18n'

export function CopyBox({ value, mono = true }: { value: string; mono?: boolean }) {
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
    <div className="flex items-stretch gap-2">
      <code
        dir="ltr" className={`flex-1 min-w-0 break-all text-start rounded-input border border-line-strong bg-lavender px-3 py-2 text-sm ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </code>
      <button type="button" onClick={copy} className="btn-secondary shrink-0" aria-label={t('common.copy')}>
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        <span className="hidden sm:inline">{copied ? t('common.copied') : t('common.copy')}</span>
      </button>
    </div>
  )
}
