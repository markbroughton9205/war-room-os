/**
 * Pause Cesium's default render loop when Terra is hidden, and recover from
 * WebGL context loss without leaving the globe on Cesium's "Rendering has stopped" panel.
 * HDR is restored after a context restore — it is not permanently disabled.
 */
import { noteTerraStabilityWarning } from './diagnostics'

export type TerraRenderLoopGuardViewer = {
  useDefaultRenderLoop: boolean
  isDestroyed?: () => boolean
  scene: {
    canvas?: {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void
    }
    highDynamicRange: boolean
    requestRender?: () => void
  }
}

export function terraCameraHasActiveFlight(camera: unknown): boolean {
  if (!camera || typeof camera !== 'object') return false
  return Boolean((camera as { _currentFlight?: unknown })._currentFlight)
}

export function applyTerraHiddenRenderLoop(viewer: TerraRenderLoopGuardViewer, hidden: boolean): void {
  if (viewer.isDestroyed?.()) return
  viewer.useDefaultRenderLoop = !hidden
  if (!hidden) {
    try {
      viewer.scene.requestRender?.()
    } catch {
      /* viewer tearing down */
    }
  }
}

export function applyTerraWebGlContextLostRecovery(viewer: TerraRenderLoopGuardViewer): void {
  if (viewer.isDestroyed?.()) return
  try {
    viewer.scene.highDynamicRange = false
    viewer.useDefaultRenderLoop = false
  } catch {
    /* viewer tearing down */
  }
  noteTerraStabilityWarning('WebGL context lost — paused render loop and HDR until restore')
}

export function applyTerraWebGlContextRestored(viewer: TerraRenderLoopGuardViewer, hidden: boolean): void {
  if (viewer.isDestroyed?.()) return
  try {
    viewer.scene.highDynamicRange = true
  } catch {
    /* viewer tearing down */
  }
  applyTerraHiddenRenderLoop(viewer, hidden)
}

export function attachTerraGlobeRenderGuard(viewer: TerraRenderLoopGuardViewer): () => void {
  const canvas = viewer.scene.canvas
  const onVisibility = () => {
    applyTerraHiddenRenderLoop(viewer, typeof document !== 'undefined' && document.visibilityState === 'hidden')
  }
  const onLost = (event: Event) => {
    try {
      event.preventDefault()
    } catch {
      /* some contexts are not cancelable */
    }
    applyTerraWebGlContextLostRecovery(viewer)
  }
  const onRestored = () => {
    applyTerraWebGlContextRestored(viewer, typeof document !== 'undefined' && document.visibilityState === 'hidden')
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }
  canvas?.addEventListener('webglcontextlost', onLost, false)
  canvas?.addEventListener('webglcontextrestored', onRestored, false)
  onVisibility()

  return () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
    canvas?.removeEventListener('webglcontextlost', onLost, false)
    canvas?.removeEventListener('webglcontextrestored', onRestored, false)
    applyTerraHiddenRenderLoop(viewer, false)
  }
}
