/**
 * During camera movement, temporarily raise globe SSE so terrain/imagery tile
 * pressure drops. Full detail restores on settle. Does not disable terrain or imagery.
 */
export const TERRA_GLOBE_SSE_SETTLED = 2
export const TERRA_GLOBE_SSE_MOVING = 4

export const TERRA_GLOBE_TILE_CACHE_SETTLED = 100
export const TERRA_GLOBE_TILE_CACHE_MOVING = 64

type GlobeLodTarget = {
  scene: {
    globe: {
      maximumScreenSpaceError: number
      tileCacheSize?: number
      preloadSiblings?: boolean
    }
  }
  isDestroyed?: () => boolean
}

export function applyTerraGlobeMovementLod(viewer: GlobeLodTarget, moving: boolean): void {
  if (viewer.isDestroyed?.()) return
  try {
    const globe = viewer.scene.globe
    globe.maximumScreenSpaceError = moving ? TERRA_GLOBE_SSE_MOVING : TERRA_GLOBE_SSE_SETTLED
    if (typeof globe.tileCacheSize === 'number') {
      globe.tileCacheSize = moving ? TERRA_GLOBE_TILE_CACHE_MOVING : TERRA_GLOBE_TILE_CACHE_SETTLED
    }
    if (typeof globe.preloadSiblings === 'boolean') {
      globe.preloadSiblings = !moving
    }
  } catch {
    /* viewer tearing down */
  }
}

export function attachTerraGlobeMovementLod(viewer: {
  camera: {
    moveStart: { addEventListener: (cb: () => void) => () => void }
    moveEnd: { addEventListener: (cb: () => void) => () => void }
  }
  scene: { globe: { maximumScreenSpaceError: number } }
  isDestroyed?: () => boolean
}): () => void {
  applyTerraGlobeMovementLod(viewer, false)
  const removeStart = viewer.camera.moveStart.addEventListener(() => applyTerraGlobeMovementLod(viewer, true))
  const removeEnd = viewer.camera.moveEnd.addEventListener(() => applyTerraGlobeMovementLod(viewer, false))
  return () => {
    removeStart()
    removeEnd()
    applyTerraGlobeMovementLod(viewer, false)
  }
}
