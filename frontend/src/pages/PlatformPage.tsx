import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Search, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFetch, formatDate, timeAgo } from '../lib/useFetch'
import { useT } from '../lib/i18n'
import { sar } from '../lib/money'
import type { PlatformCompany, PlatformCompanyDetail, PlatformOverview } from '../types'
import { PageHeader } from '../components/PageHeader'
import { PageLoader, Spinner } from '../components/Spinner'
import { ErrorNote } from '../components/ErrorNote'
import { StatusPill } from '../components/StatusPill'
import { Sheet } from '../components/Sheet'

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-lg px-4 py-3.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-xl font-extrabold tracking-tightest tnum mt-0.5">{value}</div>
    </div>
  )
}

/** Plain div bar chart: one bar per week, label under it, value on hover. */
function Bars({ title, rows, format }: { title: string; rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const t = useT()
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    <section className="card-lg p-4">
      <div className="text-sm font-bold mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-neutral-500 py-6 text-center">{t('platform.noData')}</div>
      ) : (
        <div className="flex items-end gap-1.5 h-36" role="img" aria-label={title}>
          {rows.map((r) => {
            const h = max > 0 ? Math.max(2, Math.round((r.value / max) * 100)) : 2
            return (
              <div key={r.label} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1" title={`${r.label}: ${format(r.value)}`}>
                <div className="w-full rounded-t-md bg-brand/80 hover:bg-brand transition-colors" style={{ height: `${h}%` }} />
                <div className="text-[9px] text-neutral-400 font-mono truncate max-w-full">{r.label.slice(5)}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CompanyDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const t = useT()
  const detail = useFetch(() => (id ? api.get<PlatformCompanyDetail>(`/platform/companies/${id}`).then((r) => r.data) : Promise.resolve(null)), [id])
  const d = detail.data
  const members = Array.isArray(d?.members) ? d.members : []
  const agentsRaw = (d as Record<string, unknown> | null)?.agents
  const agents = Array.isArray(d?.agents_list) ? d.agents_list : Array.isArray(agentsRaw) ? (agentsRaw as NonNullable<PlatformCompanyDetail['agents_list']>) : []
  const agentCount = typeof d?.agents === 'number' ? d.agents : agents.length
  return (
    <Sheet open={id !== null} onClose={onClose} title={d?.name ?? t('platform.company')} size="lg">
      {detail.loading && !d ? (
        <div className="py-8 flex justify-center">
          <Spinner />
        </div>
      ) : detail.error && !d ? (
        <ErrorNote message={detail.error} />
      ) : d ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{t('platform.since', { date: formatDate(d.created_at, false) })}</span>
            {d.kill_switch && (
              <StatusPill tone="red">
                <ShieldAlert className="h-3 w-3" /> {t('kill.on')}
              </StatusPill>
            )}
            <StatusPill tone={d.lithic_configured ? 'green' : 'neutral'}>{d.lithic_configured ? t('platform.lithicOn') : t('platform.lithicOff')}</StatusPill>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label={t('platform.users')} value={d.users ?? members.length} />
            <Tile label={t('platform.agents')} value={agentCount} />
            <Tile label={t('platform.volume30d')} value={sar(d.volume_30d, { compact: true })} />
            <Tile label={t('platform.fees30d')} value={sar(d.fees_30d, { compact: true })} />
          </div>
          {members.length > 0 && (
            <div>
              <div className="text-sm font-bold mb-1.5">{t('platform.members')}</div>
              <ul className="divide-y divide-line text-sm">
                {members.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate">
                      <span className="font-semibold">{m.full_name}</span>
                      {m.email && <span className="text-neutral-500 text-xs"> · {m.email}</span>}
                    </span>
                    {m.role && <span className="text-xs text-neutral-500">{t(`role.${m.role}`)}</span>}
                    {m.status && m.status !== 'active' && <StatusPill tone="neutral">{m.status}</StatusPill>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {agents.length > 0 && (
            <div>
              <div className="text-sm font-bold mb-1.5">{t('platform.agents')}</div>
              <ul className="divide-y divide-line text-sm">
                {agents.map((a) => (
                  <li key={a.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate font-semibold">{a.name}</span>
                    {typeof a.spent_this_period === 'number' && <span className="tnum text-xs text-neutral-600">{sar(a.spent_this_period)}</span>}
                    {a.status && <StatusPill status={a.status} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Sheet>
  )
}

/** Read-only console for Flaire staff: every company on the platform and what it does. */
export default function PlatformPage() {
  const { user } = useAuth()
  const t = useT()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const overview = useFetch(() => api.get<PlatformOverview>('/platform/overview').then((r) => r.data), [])
  const companies = useFetch(() => api.get<PlatformCompany[]>('/platform/companies').then((r) => r.data), [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = companies.data ?? []
    return (needle ? list.filter((c) => c.name.toLowerCase().includes(needle) || String(c.id) === needle) : list).slice().sort((a, b) => b.volume_30d - a.volume_30d)
  }, [companies.data, q])

  if (!user?.is_platform_admin) return <Navigate to="/" replace />

  const o = overview.data
  const openRow = (id: number) => setOpenId(id)

  return (
    <div>
      <PageHeader title={t('platform.title')} subtitle={t('platform.subtitle')} />

      {overview.error && !o && <ErrorNote message={overview.error} className="mb-4" />}
      {overview.loading && !o ? (
        <PageLoader />
      ) : o ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile label={t('platform.companies')} value={o.companies} />
            <Tile label={t('platform.users')} value={o.users} />
            <Tile label={t('platform.activeAgents')} value={`${o.active_agents} / ${o.agents}`} />
            <Tile label={t('platform.volume30d')} value={sar(o.volume_30d, { compact: true })} />
            <Tile label={t('platform.fees30d')} value={sar(o.fees_30d, { compact: true })} />
            <Tile label={t('platform.feesTotal')} value={sar(o.fees_total, { compact: true })} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Bars title={t('platform.signupsByWeek')} rows={(o.signups_by_week ?? []).map((w) => ({ label: w.week, value: w.companies }))} format={(v) => String(v)} />
            <Bars title={t('platform.volumeByWeek')} rows={(o.volume_by_week ?? []).map((w) => ({ label: w.week, value: w.volume }))} format={(v) => sar(v)} />
          </div>

          {(o.top_companies ?? []).length > 0 && (
            <section className="card-lg overflow-hidden">
              <div className="px-4 pt-4 pb-2 text-sm font-bold">{t('platform.topCompanies')}</div>
              <table className="w-full text-sm">
                <thead className="text-[11px] text-neutral-500">
                  <tr className="border-b border-line">
                    <th className="text-start font-medium px-4 py-1.5">{t('platform.company')}</th>
                    <th className="text-end font-medium px-4 py-1.5">{t('platform.volume30d')}</th>
                    <th className="text-end font-medium px-4 py-1.5">{t('platform.fees30d')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.top_companies.map((c) => (
                    <tr key={c.id} className="hover:bg-lavender/60 cursor-pointer" onClick={() => openRow(c.id)}>
                      <td className="px-4 py-2 font-semibold">{c.name}</td>
                      <td className="px-4 py-2 text-end tnum">{sar(c.volume_30d)}</td>
                      <td className="px-4 py-2 text-end tnum">{sar(c.fees_30d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      ) : null}

      <section className="mt-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-sm font-bold">{t('platform.allCompanies')}</h2>
          <span className="text-xs text-neutral-500 tnum">{filtered.length}</span>
          <label className="relative ms-auto">
            <Search className="h-4 w-4 text-neutral-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input className="input h-9 ps-9 w-64 max-w-full text-sm" placeholder={t('platform.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {companies.loading && !companies.data ? (
          <PageLoader />
        ) : companies.error && !companies.data ? (
          <ErrorNote message={companies.error} />
        ) : filtered.length === 0 ? (
          <div className="card-lg px-4 py-8 text-center text-xs text-neutral-500">{t('platform.noCompanies')}</div>
        ) : (
          <div className="card-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-[11px] text-neutral-500">
                <tr className="border-b border-line">
                  <th className="text-start font-medium px-4 py-2">{t('platform.company')}</th>
                  <th className="text-end font-medium px-3 py-2">{t('platform.users')}</th>
                  <th className="text-end font-medium px-3 py-2">{t('platform.agents')}</th>
                  <th className="text-end font-medium px-3 py-2">{t('platform.tx30d')}</th>
                  <th className="text-end font-medium px-3 py-2">{t('platform.volume30d')}</th>
                  <th className="text-end font-medium px-3 py-2">{t('platform.fees30d')}</th>
                  <th className="text-start font-medium px-3 py-2">{t('platform.lastActivity')}</th>
                  <th className="text-start font-medium px-3 py-2">{t('platform.state')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-lavender/60 cursor-pointer" onClick={() => openRow(c.id)}>
                    <td className="px-4 py-2">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-[11px] text-neutral-500">{t('platform.since', { date: formatDate(c.created_at, false) })}</div>
                    </td>
                    <td className="px-3 py-2 text-end tnum">{c.users}</td>
                    <td className="px-3 py-2 text-end tnum">{c.agents}</td>
                    <td className="px-3 py-2 text-end tnum">{c.transactions_30d}</td>
                    <td className="px-3 py-2 text-end tnum">{sar(c.volume_30d)}</td>
                    <td className="px-3 py-2 text-end tnum">{sar(c.fees_30d)}</td>
                    <td className="px-3 py-2 text-xs text-neutral-600 whitespace-nowrap">{timeAgo(c.last_activity)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.kill_switch && <StatusPill tone="red">{t('kill.on')}</StatusPill>}
                        <StatusPill tone={c.lithic_configured ? 'green' : 'neutral'}>{c.lithic_configured ? t('platform.lithicOn') : t('platform.lithicOff')}</StatusPill>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CompanyDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
