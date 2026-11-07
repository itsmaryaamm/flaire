import { Loader2 } from 'lucide-react'
import { useT } from '../lib/i18n'

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />
}

export function PageLoader({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-neutral-500">
      <Spinner />
      {label ?? t('common.loading')}
    </div>
  )
}
