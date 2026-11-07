import { useState } from 'react'
import { Plug, Trash2 } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch, formatDate, timeAgo } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import type { Connection, ConnectorInfo } from '../../types'
import { CopyBox } from '../CopyBox'
import { ErrorNote } from '../ErrorNote'
import { Spinner } from '../Spinner'

/** Settings card: the MCP connector URL plus the list of connected Claude clients. */
export function ConnectClaudeCard() {
  const toast = useToast()
  const info = useFetch(() => api.get<ConnectorInfo>('/connector-info').then((r) => r.data), [])
  const connections = useFetch(() => api.get<Connection[]>('/connections').then((r) => r.data), [])
  const [revoking, setRevoking] = useState<number | null>(null)

  const revoke = async (c: Connection) => {
    if (!window.confirm(`Revoke ${c.agent_name}'s Claude connection? That Claude will have to connect again.`)) return
    setRevoking(c.id)
    try {
      await api.delete(`/connections/${c.id}`)
      toast.success('Connection revoked.')
      await connections.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRevoking(null)
    }
  }

  const list = connections.data ?? []

  return (
    <section id="connect" className="card-lg p-5 lg:col-span-2 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-brand" />
        <h3 className="font-bold">Connect your Claude</h3>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">
        Add Flaire as a connector in Claude. Each Claude signs in as one AI employee and spends only within that employee's limits.
      </p>

      {info.loading && !info.data ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2">
          <Spinner /> Loading connector details
        </div>
      ) : info.error && !info.data ? (
        <ErrorNote message={info.error} />
      ) : info.data ? (
        <div className="space-y-3">
          <div>
            <div className="label">Connector URL</div>
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
            Authentication: choose <strong className="text-ink">Sign in now</strong>. Claude will open Flaire's sign-in page.
          </div>
        </div>
      ) : null}

      <div className="mt-5 pt-4 border-t border-line">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold">Connected Claudes</h4>
          <button className="btn-ghost text-xs" onClick={() => connections.refetch()} disabled={connections.loading}>
            {connections.loading && <Spinner className="h-3.5 w-3.5" />} Refresh
          </button>
        </div>
        {connections.error && !connections.data ? (
          <ErrorNote message={connections.error} />
        ) : list.length === 0 ? (
          <div className="rounded-input border border-dashed border-line-strong px-3 py-4 text-center text-sm text-neutral-500">No Claude connected yet.</div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full min-w-[560px]">
              <thead className="bg-lavender border-y border-line">
                <tr>
                  <th className="th">AI employee</th>
                  <th className="th">Connected by</th>
                  <th className="th">Connected</th>
                  <th className="th">Last used</th>
                  <th className="th text-right">Access</th>
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
                    <td className="td text-right">
                      <button className="btn-ghost text-xs text-danger hover:bg-danger-tint" onClick={() => revoke(c)} disabled={revoking === c.id}>
                        {revoking === c.id ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />} Revoke
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
