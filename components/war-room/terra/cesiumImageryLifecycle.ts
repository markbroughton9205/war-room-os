'use client'

import type { ImageryLayer, Viewer as CesiumViewer } from 'cesium'

/**
 * Cesium globe draw commands keep pointers into Imagery.texture for the current frame.
 * `imageryLayers.remove(layer, true)` destroys those textures immediately, which is the
 * TypeError: Cannot read properties of undefined (reading 'texture') crash during zoom.
 *
 * Hide first, then destroy only after postRender so the in-flight command list is gone.
 */
const pendingRelease = new WeakMap<ImageryLayer, () => void>()

function layerDestroyed(layer: ImageryLayer): boolean {
  return typeof layer.isDestroyed === 'function' && layer.isDestroyed()
}

export function releaseImageryLayerAfterRender(
  viewer: CesiumViewer,
  layer: ImageryLayer | null | undefined,
): void {
  if (!layer) return
  const previous = pendingRelease.get(layer)
  if (previous) previous()

  const finish = () => {
    pendingRelease.delete(layer)
    try {
      if (!viewer.isDestroyed() && viewer.imageryLayers.contains(layer)) {
        viewer.imageryLayers.remove(layer, true)
        return
      }
    } catch {
      /* viewer or collection already torn down */
    }
    try {
      if (!layerDestroyed(layer)) layer.destroy()
    } catch {
      /* already destroyed */
    }
  }

  if (viewer.isDestroyed()) {
    finish()
    return
  }

  try {
    layer.show = false
    layer.alpha = 0
  } catch {
    finish()
    return
  }

  let frames = 2
  let removeListener: (() => void) | null = null
  const onPostRender = () => {
    frames -= 1
    if (frames > 0) return
    if (removeListener) {
      try { removeListener() } catch { /* ignore */ }
      removeListener = null
    }
    finish()
  }
  pendingRelease.set(layer, () => {
    if (removeListener) {
      try { removeListener() } catch { /* ignore */ }
      removeListener = null
    }
    finish()
  })
  try {
    removeListener = viewer.scene.postRender.addEventListener(onPostRender)
  } catch {
    finish()
  }
}

export function hideImageryLayer(layer: ImageryLayer | null | undefined): void {
  if (!layer || layerDestroyed(layer)) return
  try {
    layer.show = false
    layer.alpha = 0
  } catch {
    /* already gone */
  }
}

export function attachCameraMovementGate(
  viewer: CesiumViewer,
  onMovingChange: (moving: boolean) => void,
): () => void {
  const removeStart = viewer.camera.moveStart.addEventListener(() => onMovingChange(true))
  const removeEnd = viewer.camera.moveEnd.addEventListener(() => onMovingChange(false))
  return () => {
    if (viewer.isDestroyed()) return
    removeStart()
    removeEnd()
  }
}
