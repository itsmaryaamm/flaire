import { AlertCircle } from 'lucide-react'

export function ErrorNote({ message, className = '' }: { message: string | null; className?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}
    >
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
