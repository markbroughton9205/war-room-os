'use client'

import type { Viewer as CesiumViewer } from 'cesium'

/**
 * BillboardCollection draw commands read `u_atlas` as `textureAtlas.texture`.
 * Destroying a LabelCollection in the same frame that already queued those commands
 * nulls the atlas and throws:
 * TypeError: Cannot read properties of undefined (reading 'texture')
 *
 * Hide immediately so the next update does not queue another command, then remove
 * only after postRender so the in-flight command list has finished.
 */
type ReleasablePrimitive = {
  show?: boolean
  isDestroyed?: () => boolean
  destroy?: () => void
}

const pendingRelease = new WeakMap<object, () => void>()

function primitiveDestroyed(primitive: ReleasablePrimitive): boolean {
  return typeof primitive.isDestroyed === 'function' && primitive.isDestroyed()
}

export function releaseScenePrimitiveAfterRender(
  viewer: CesiumViewer,
  primitive: ReleasablePrimitive | null | undefined,
): void {
  if (!primitive || primitiveDestroyed(primitive)) return
  const previous = pendingRelease.get(primitive)
  if (previous) previous()

  const finish = () => {
    pendingRelease.delete(primitive)
    try {
      if (!viewer.isDestroyed() && viewer.scene.primitives.contains(primitive)) {
        viewer.scene.primitives.remove(primitive)
        return
      }
    } catch {
      /* viewer or collection already torn down */
    }
    try {
      if (!primitiveDestroyed(primitive)) primitive.destroy?.()
    } catch {
      /* already destroyed */
    }
  }

  if (viewer.isDestroyed()) {
    finish()
    return
  }

  try {
    primitive.show = false
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
  pendingRelease.set(primitive, () => {
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
