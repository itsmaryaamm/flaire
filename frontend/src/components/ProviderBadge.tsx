import type { CardProvider } from '../types'

export const PROVIDERS: { value: CardProvider; label: string; bank: string; short: string }[] = [
  { value: 'mock_snb', label: 'SNB (simulated)', bank: 'Saudi National Bank', short: 'Mock SNB' },
  { value: 'mock_rajhi', label: 'Al Rajhi (simulated)', bank: 'Al Rajhi Bank', short: 'Mock Al Rajhi' },
  { value: 'mock_riyad', label: 'Riyad Bank (simulated)', bank: 'Riyad Bank', short: 'Mock Riyad' },
  { value: 'lithic', label: 'Lithic sandbox', bank: 'Lithic', short: 'Lithic sandbox' },
]

export function providerInfo(p: string) {
  return PROVIDERS.find((x) => x.value === p) ?? { value: p, label: p, bank: p, short: p }
}

export function ProviderBadge({ provider }: { provider: string }) {
  const info = providerInfo(provider)
  const cls =
    provider === 'lithic'
      ? 'bg-violet-100 text-violet-800 border-violet-300/60'
      : 'bg-neutral-100 text-neutral-700 border-neutral-300/60'
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      {info.short}
    </span>
  )
}
