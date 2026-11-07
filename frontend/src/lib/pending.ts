import { useCallback } from 'react'
import { pendingChangeId } from './api'
import { useToast } from './toast'
import { useT } from './i18n'

/**
 * Policy PATCHes (company, department, employee limits) may answer 202 when the change needs a second admin.
 * Returns a function that shows the "sent for approval" toast and reports whether the response was such a 202.
 */
export function usePendingChange(): (res: { status: number; data: unknown }) => boolean {
  const toast = useToast()
  const t = useT()
  return useCallback(
    (res) => {
      const id = pendingChangeId(res)
      if (id === null) return false
      toast.info(t('policy.sentForApproval'), { label: t('policy.openPolicy'), to: '/policy' })
      return true
    },
    [toast, t],
  )
}
