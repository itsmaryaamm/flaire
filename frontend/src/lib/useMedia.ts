import { useEffect, useState } from 'react'

/** True below Tailwind's md breakpoint (phones). Updates on resize. */
export function useIsPhone(): boolean {
  const query = '(max-width: 767px)'
  const [phone, setPhone] = useState<boolean>(() => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(query)
    } catch {
      return
    }
    const onChange = () => setPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return phone
}
