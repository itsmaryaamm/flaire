import { AlertCircle } from 'lucide-react'

export function ErrorNote({ message, className = '' }: { message: string | null; className?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-input border border-red-200 bg-danger-tint px-3 py-2 text-sm text-danger ${className}`}
    >
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
