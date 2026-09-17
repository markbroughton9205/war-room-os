import type { Viewer as CesiumViewer } from 'cesium'

let dragging = false

export function isTerraWorkspacePanelDragging(): boolean {
  return dragging
}

export function setTerraGlobeInputsEnabled(viewer: CesiumViewer | null | undefined, enabled: boolean): void {
  dragging = !enabled
  if (!viewer) return
  try {
    if (typeof viewer.isDestroyed === 'function' && viewer.isDestroyed()) return
    viewer.scene.screenSpaceCameraController.enableInputs = enabled
    const canvas = viewer.scene.canvas
    if (canvas) canvas.style.pointerEvents = enabled ? '' : 'none'
  } catch {
    /* Viewer may be mid-teardown. */
  }
}
