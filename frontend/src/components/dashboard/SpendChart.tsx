import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { sar } from '../../lib/money'
import type { DashboardSummary } from '../../types'
import { Money } from '../Money'

export function SpendChart({ data }: { data: DashboardSummary['spend_by_day'] }) {
  const rows = data.map((d) => ({
    date: d.date,
    label: new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    sar: d.amount / 100,
  }))
  const total = data.reduce((a, b) => a + b.amount, 0)
  return (
    <div className="card-lg p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="font-bold">Spend, last 14 days</h3>
          <p className="text-xs text-neutral-500 mt-0.5">Completed purchases by day</p>
        </div>
        <Money halalas={total} className="text-sm font-bold" />
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#E8E3F0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#8A80A0', fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#8A80A0', fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              cursor={{ fill: '#F3EFFA' }}
              contentStyle={{ borderRadius: 12, border: '1px solid #E8E3F0', fontSize: 12, fontFamily: 'Plus Jakarta Sans' }}
              formatter={(v: number) => [sar(Math.round(v * 100)), 'Spent']}
            />
            <Bar dataKey="sar" fill="#7B2FF2" radius={[6, 6, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
