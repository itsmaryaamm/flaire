import { useState } from 'react'
import { Plug, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch, formatDate, timeAgo } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import type { Connection, ConnectorInfo } from '../../types'
import { CopyBox } from '../CopyBox'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'
import { useT } from '../../lib/i18n'

/** Settings card: the MCP connector URL plus the list of connected Claude clients. */
export function ConnectClaudeCard() {
  const toast = useToast()
  const t = useT()
  const info = useFetch(() => api.get<ConnectorInfo>('/connector-info').then((r) => r.data), [])
  const connections = useFetch(() => api.get<Connection[]>('/connections').then((r) => r.data), [])
  const [revoking, setRevoking] = useState<number | null>(null)

  const revoke = async (c: Connection) => {
    if (!window.confirm(t('settings.revokeConfirm', { name: c.agent_name }))) return
    setRevoking(c.id)
    try {
      await api.delete(`/connections/${c.id}`)
      toast.success(t('settings.connectionRevoked'))
      await connections.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRevoking(null)
    }
  }

  const list = connections.data ?? []

  return (
    <section id="connect" className="card-lg p-5 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-brand" />
        <h3 className="font-bold">{t('settings.connectClaude')}</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">{t('settings.connectHint')}</p>

      {info.loading && !info.data ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
          <Spinner /> {t('settings.loadingConnector')}
        </div>
      ) : info.error && !info.data ? (
        <ErrorNote message={info.error} />
      ) : info.data ? (
        <div className="space-y-3">
          <div>
            <div className="label">{t('settings.connectorUrl')}</div>
            <CopyBox value={info.data.url} />
          </div>
          <ol className="space-y-1.5 text-sm text-neutral-600">
            {info.data.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-[11px] font-bold tnum">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <div className="rounded-input border border-line bg-lavender px-3 py-2 text-xs text-neutral-600">
            {t('settings.authChoose')} <strong className="text-ink">{t('settings.signInNow')}</strong>. {t('settings.claudeOpensSignIn')}
          </div>
        </div>
      ) : null}

      <div className="mt-5 pt-4 border-t border-line">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">{t('settings.connectedClaudes')}</h4>
          <button className="btn-ghost text-xs" onClick={() => connections.refetch()} disabled={connections.loading}>
            {connections.loading && <Spinner className="h-3.5 w-3.5" />} {t('common.refresh')}
          </button>
        </div>
        {connections.error && !connections.data ? (
          <ErrorNote message={connections.error} />
        ) : list.length === 0 ? (
          <div className="rounded-input border border-dashed border-line-strong px-3 py-4 text-center text-sm text-neutral-500">{t('settings.noClaudeYet')}</div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full min-w-[560px]">
              <thead className="bg-lavender border-y border-line">
                <tr>
                  <th className="th">{t('settings.aiEmployee')}</th>
                  <th className="th">{t('settings.connectedBy')}</th>
                  <th className="th">{t('settings.connected')}</th>
                  <th className="th">{t('settings.lastUsed')}</th>
                  <th className="th text-end">{t('settings.access')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => (
                  <tr key={c.id} className="hover:bg-lavender/70">
                    <td className="td font-semibold">
                      {c.agent_name}
                      <span className="block text-[11px] font-normal text-neutral-500">{c.client}</span>
                    </td>
                    <td className="td">{c.connected_by}</td>
                    <td className="td text-neutral-600 whitespace-nowrap">{formatDate(c.created_at, false)}</td>
                    <td className="td text-neutral-600 whitespace-nowrap">{timeAgo(c.last_used_at)}</td>
                    <td className="td text-end">
                      <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => revoke(c)} disabled={revoking === c.id}>
                        {revoking === c.id ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} {t('settings.revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
