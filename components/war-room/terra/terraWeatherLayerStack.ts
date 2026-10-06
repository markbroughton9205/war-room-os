'use client'

import type { ImageryLayer, Viewer as CesiumViewer } from 'cesium'

type WeatherStack = {
  radar: ImageryLayer[]
  clouds: ImageryLayer[]
}

const stacks = new WeakMap<CesiumViewer, WeatherStack>()

function stackFor(viewer: CesiumViewer): WeatherStack {
  const existing = stacks.get(viewer)
  if (existing) return existing
  const created: WeatherStack = { radar: [], clouds: [] }
  stacks.set(viewer, created)
  return created
}

function prune(viewer: CesiumViewer, list: ImageryLayer[]): ImageryLayer[] {
  return list.filter(layer => {
    try {
      return !viewer.isDestroyed() && viewer.imageryLayers.contains(layer)
    } catch {
      return false
    }
  })
}

export function registerWeatherImageryLayer(
  viewer: CesiumViewer,
  kind: 'radar' | 'clouds',
  layer: ImageryLayer,
): void {
  if (viewer.isDestroyed()) return
  const stack = stackFor(viewer)
  stack.radar = prune(viewer, stack.radar).filter(item => item !== layer)
  stack.clouds = prune(viewer, stack.clouds).filter(item => item !== layer)
  stack[kind].push(layer)
  ensureWeatherRenderOrder(viewer)
}

export function unregisterWeatherImageryLayer(viewer: CesiumViewer, layer: ImageryLayer): void {
  if (viewer.isDestroyed()) return
  const stack = stacks.get(viewer)
  if (!stack) return
  stack.radar = stack.radar.filter(item => item !== layer)
  stack.clouds = stack.clouds.filter(item => item !== layer)
}

/**
 * Cesium paints higher indices on top. Desired:
 * EARTH_IMAGERY / NIGHT_LIGHTS → RADAR → CLOUDS.
 * Earth/night layers may be added after weather; raise weather above them without
 * putting radar over clouds.
 */
export function ensureWeatherRenderOrder(viewer: CesiumViewer): void {
  if (viewer.isDestroyed()) return
  const stack = stacks.get(viewer)
  if (!stack) return
  stack.radar = prune(viewer, stack.radar)
  stack.clouds = prune(viewer, stack.clouds)
  const layers = viewer.imageryLayers
  for (const radar of stack.radar) {
    if (layers.contains(radar)) layers.raiseToTop(radar)
  }
  for (const cloud of stack.clouds) {
    if (layers.contains(cloud)) layers.raiseToTop(cloud)
  }
}

export function ensureRadarBelowClouds(viewer: CesiumViewer): void {
  ensureWeatherRenderOrder(viewer)
}
