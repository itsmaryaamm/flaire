import { sar } from '../../lib/money'
import { formatDate } from '../../lib/useFetch'
import type { FeeStatement } from '../../types'
import { Modal } from '../Modal'

/** Simple statement: every transaction this month with its Flaire fee. */
export function FeesModal({ open, onClose, statement }: { open: boolean; onClose: () => void; statement: FeeStatement | null }) {
  return (
    <Modal open={open} onClose={onClose} title={`Flaire fees, ${statement?.month ?? ''}`} size="md">
      {!statement ? null : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-neutral-500">Volume</div>
              <div className="font-semibold tnum">{sar(statement.volume)}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Rate</div>
              <div className="font-semibold tnum">{(statement.fee_rate_bps / 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Fees</div>
              <div className="font-semibold tnum">{sar(statement.fees)}</div>
            </div>
          </div>
          {statement.lines.length === 0 ? (
            <p className="text-sm text-neutral-500">No transactions this month.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {statement.lines.map((l) => (
                <li key={l.id} className="py-2 flex items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-neutral-500 w-14 shrink-0">{formatDate(l.created_at, false)}</span>
                  <span className="flex-1 min-w-0 truncate">{l.merchant}</span>
                  <span className="tnum text-neutral-600">{sar(l.amount)}</span>
                  <span className="tnum font-semibold w-24 text-right">{sar(l.fee)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}
