import type { ReactNode } from 'react'
import { useIsPhone } from '../lib/useMedia'
import { BottomSheet } from './BottomSheet'
import { Modal } from './Modal'

/** Bottom sheet on phones, centered modal on larger screens. Same content either way. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'sm',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const phone = useIsPhone()
  if (phone) {
    return (
      <BottomSheet open={open} onClose={onClose} title={title}>
        {children}
        {footer && <div className="mt-4 flex flex-col gap-2">{footer}</div>}
      </BottomSheet>
    )
  }
  return (
    <Modal open={open} onClose={onClose} title={title} size={size} footer={footer}>
      {children}
    </Modal>
  )
}
