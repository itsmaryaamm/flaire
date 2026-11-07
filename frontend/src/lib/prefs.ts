/** Small per-device preferences kept in localStorage. Every access is guarded: storage may be blocked or throw. */

export const PREFER_FULL_KEY = 'flaire:prefer-full'

export function prefersFullDashboard(): boolean {
  try {
    return localStorage.getItem(PREFER_FULL_KEY) === '1'
  } catch {
    return false
  }
}

export function setPreferFullDashboard(on: boolean) {
  try {
    if (on) localStorage.setItem(PREFER_FULL_KEY, '1')
    else localStorage.removeItem(PREFER_FULL_KEY)
  } catch {
    // storage unavailable, ignore
  }
}

/** Phone-sized viewport (below Tailwind's sm breakpoint). */
export function isNarrowViewport(): boolean {
  try {
    return window.innerWidth < 640
  } catch {
    return false
  }
}
