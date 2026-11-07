import { useRef, useState } from 'react'
import { Download, Lock, Paperclip, Trash2, Upload } from 'lucide-react'
import { api, downloadFile, errorMessage } from '../../lib/api'
import { useFetch, formatDate } from '../../lib/useFetch'
import { useT } from '../../lib/i18n'
import { useToast } from '../../lib/toast'
import type { Attachment, Transaction } from '../../types'
import { Sheet } from '../Sheet'
import { Spinner } from '../Spinner'
import { ErrorNote } from '../ErrorNote'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

/** Paperclip count plus a "Receipts" button that opens the upload / list sheet for one transaction. */
export function ReceiptsButton({ tx }: { tx: Transaction }) {
  const t = useT()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = useFetch(() => api.get<Attachment[]>(`/transactions/${tx.id}/attachments`).then((r) => r.data), [tx.id])
  const items = list.data ?? []
  const locked = !!tx.locked

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) {
      setError(t('receipts.tooLarge'))
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post(`/transactions/${tx.id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success(t('receipts.uploaded'))
      await list.refetch()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (a: Attachment) => {
    setDeleting(a.id)
    setError(null)
    try {
      await api.delete(`/attachments/${a.id}`)
      toast.success(t('receipts.deleted'))
      await list.refetch()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setDeleting(null)
    }
  }

  const download = async (a: Attachment) => {
    try {
      await downloadFile(`/attachments/${a.id}/download`, a.filename)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary text-xs h-7 px-2.5" onClick={() => setOpen(true)}>
        <Paperclip className="h-3 w-3" />
        <span className="tnum">{list.data ? items.length : ''}</span> {t('receipts.title')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('receipts.sheetTitle', { merchant: tx.merchant })} size="md">
        <div className="space-y-3">
          {locked ? (
            <div className="flex items-start gap-2 rounded-input border border-line bg-lavender px-3 py-2.5 text-xs text-neutral-600">
              <Lock className="h-4 w-4 shrink-0 mt-px" />
              <span>{t('receipts.locked', { period: tx.period ?? '' })}</span>
            </div>
          ) : (
            <div>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
              <button type="button" className="btn-primary text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />} {t('receipts.upload')}
              </button>
              <p className="text-xs text-neutral-500 mt-1.5">{t('receipts.accepted')}</p>
            </div>
          )}
          <ErrorNote message={error} />
          {list.loading && !list.data ? (
            <div className="py-3 text-xs text-neutral-500 flex items-center gap-2">
              <Spinner className="h-3.5 w-3.5" /> {t('common.loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-input border border-dashed border-line-strong px-3 py-4 text-center text-xs text-neutral-500">{t('receipts.none')}</div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-neutral-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{a.filename}</div>
                    <div className="text-[11px] text-neutral-500 tnum">
                      {kb(a.size)} · {formatDate(a.created_at)}
                    </div>
                  </div>
                  <button className="btn-ghost p-1.5" onClick={() => download(a)} aria-label={t('common.download')} title={t('common.download')}>
                    <Download className="h-4 w-4" />
                  </button>
                  {!locked && (
                    <button className="btn-ghost p-1.5 text-danger hover:bg-danger-tint" onClick={() => remove(a)} disabled={deleting === a.id} aria-label={t('common.delete')} title={t('common.delete')}>
                      {deleting === a.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  )
}
