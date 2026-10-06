/**
 * Flag-gated Terra runtime counters. Normal UI stays quiet.
 * Enable with localStorage TERRA_DIAGNOSTICS=1 or ?terraDiagnostics=1.
 */
export type TerraDiagnosticsSnapshot = {
  enabled: boolean
  viewerCount: number
  duplicateViewer: boolean
  warnings: string[]
  sampledAt: number
}

const viewers = new Set<object>()
let warnedDuplicate = false

export function terraDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.localStorage?.getItem('TERRA_DIAGNOSTICS') === '1') return true
  } catch {
    /* storage blocked */
  }
  return /(?:^|[?&])terraDiagnostics=1(?:&|$)/.test(window.location.search)
}

export function registerTerraViewer(viewer: object): void {
  viewers.add(viewer)
  if (viewers.size > 1 && !warnedDuplicate) {
    warnedDuplicate = true
    console.warn('[Terra] duplicate Cesium viewer detected', viewers.size)
  }
  publish()
}

export function unregisterTerraViewer(viewer: object): void {
  viewers.delete(viewer)
  if (viewers.size <= 1) warnedDuplicate = false
  publish()
}

export function terraViewerCount(): number {
  return viewers.size
}

export function snapshotTerraDiagnostics(): TerraDiagnosticsSnapshot {
  const duplicateViewer = viewers.size > 1
  const warnings: string[] = []
  if (duplicateViewer) warnings.push(`duplicate Cesium viewers: ${viewers.size}`)
  return {
    enabled: terraDiagnosticsEnabled(),
    viewerCount: viewers.size,
    duplicateViewer,
    warnings,
    sampledAt: Date.now(),
  }
}

function publish(): void {
  if (typeof window === 'undefined') return
  const snapshot = snapshotTerraDiagnostics()
  ;(window as Window & { __terraDiagnostics?: TerraDiagnosticsSnapshot }).__terraDiagnostics = snapshot
}

export function noteTerraStabilityWarning(message: string): void {
  if (!terraDiagnosticsEnabled()) return
  console.warn(`[Terra diagnostics] ${message}`)
}
