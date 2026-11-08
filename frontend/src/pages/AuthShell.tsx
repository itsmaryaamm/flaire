import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LanguageSwitch } from '../lib/i18n'

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-10">
      <Link to="/" aria-label="Flaire">
        <img src="/flaire-logo.png" alt="Flaire" className="h-9 w-auto mb-8" />
      </Link>
      <div className="w-full max-w-md card-lg p-7 sm:p-9">
        <h1 className="text-2xl font-extrabold tracking-tightest">{title}</h1>
        <p className="text-sm text-neutral-600 mt-1.5 mb-6">{subtitle}</p>
        {children}
      </div>
      <div className="mt-6">
        <LanguageSwitch />
      </div>
    </div>
  )
}
