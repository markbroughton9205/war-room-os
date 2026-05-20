export const LIVE_COUNCIL_SCROLL_STORAGE_KEY = 'war-room-live-council-scroll-top'

export function readLiveCouncilScrollTop(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(LIVE_COUNCIL_SCROLL_STORAGE_KEY)
    if (!raw) return null
    const top = Number(raw)
    return Number.isFinite(top) && top >= 0 ? top : null
  } catch {
    return null
  }
}

export function writeLiveCouncilScrollTop(top: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(LIVE_COUNCIL_SCROLL_STORAGE_KEY, String(Math.max(0, Math.round(top))))
  } catch {
    /* quota */
  }
}
