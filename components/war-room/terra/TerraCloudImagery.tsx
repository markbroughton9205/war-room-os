'use client'

import { useEffect, useRef } from 'react'
import type { ImageryLayer, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { EarthPulseCloudFrame } from '@/lib/terra/earthPulse'
import {
  TERRA_CLOUD_CROSSFADE_MS,
} from '@/lib/terra/earthPulse'
import { cloudOpacityForHeight } from '@/lib/terra/weather/atmosphere'
import {
  attachCameraMovementGate,
  hideImageryLayer,
  releaseImageryLayerAfterRender,
} from './cesiumImageryLifecycle'
import { ensureRadarBelowClouds, registerWeatherImageryLayer, unregisterWeatherImageryLayer } from './terraWeatherLayerStack'

type Slot = { layer: ImageryLayer; url: string }

type Hemisphere = {
  front: Slot | null
  back: Slot | null
}

function emptyHemisphere(): Hemisphere {
  return { front: null, back: null }
}

function dropSlot(viewer: CesiumViewer, slot: Slot | null): void {
  if (!slot || viewer.isDestroyed()) return
  unregisterWeatherImageryLayer(viewer, slot.layer)
  releaseImageryLayerAfterRender(viewer, slot.layer)
}

function hideHemisphere(hem: Hemisphere): void {
  hideImageryLayer(hem.front?.layer)
  hideImageryLayer(hem.back?.layer)
}

function dropHemisphere(viewer: CesiumViewer, hem: Hemisphere): void {
  dropSlot(viewer, hem.front)
  dropSlot(viewer, hem.back)
  hem.front = null
  hem.back = null
}

/**
 * Persistent double-buffer per GOES hemisphere.
 * Frame change loads the next observed URL into the inactive layer, crossfades, then recycles.
 * Alpha follows camera height (presentation). Max 4 cloud layers.
 */
export function TerraCloudImagery({
  viewer,
  eastFrame,
  westFrame,
  enabled,
  commanderOpacity = 1,
  depthAuto = true,
  saturation = 1,
  colorToAlphaThreshold = 0.18,
}: {
  viewer: CesiumViewer | null
  eastFrame: EarthPulseCloudFrame | null
  westFrame: EarthPulseCloudFrame | null
  enabled: boolean
  commanderOpacity?: number
  depthAuto?: boolean
  saturation?: number
  colorToAlphaThreshold?: number
}) {
  const eastRef = useRef<Hemisphere>(emptyHemisphere())
  const westRef = useRef<Hemisphere>(emptyHemisphere())
  const generationRef = useRef(0)
  const fadeHandlesRef = useRef<number[]>([])
  const commanderOpacityRef = useRef(commanderOpacity)
  const depthAutoRef = useRef(depthAuto)
  const saturationRef = useRef(saturation)
  const colorToAlphaThresholdRef = useRef(colorToAlphaThreshold)
  const applyAlphaRef = useRef<(() => void) | null>(null)
  const movingRef = useRef(false)
  const desiredEastRef = useRef<EarthPulseCloudFrame | null>(null)
  const desiredWestRef = useRef<EarthPulseCloudFrame | null>(null)
  const desiredEnabledRef = useRef(enabled)
  const flushFramesRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    commanderOpacityRef.current = commanderOpacity
    depthAutoRef.current = depthAuto
    saturationRef.current = saturation
    colorToAlphaThresholdRef.current = colorToAlphaThreshold
    applyAlphaRef.current?.()
  }, [commanderOpacity, depthAuto, saturation, colorToAlphaThreshold])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    return () => {
      generationRef.current += 1
      for (const handle of fadeHandlesRef.current) cancelAnimationFrame(handle)
      fadeHandlesRef.current = []
      applyAlphaRef.current = null
      dropHemisphere(targetViewer, eastRef.current)
      dropHemisphere(targetViewer, westRef.current)
    }
  }, [viewer])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    let cancelled = false
    let removeCamera: (() => void) | null = null

    void loadCesium().then(() => {
      if (cancelled || targetViewer.isDestroyed()) return
      const applyAlpha = () => {
        if (targetViewer.isDestroyed()) return
        const height = targetViewer.camera.positionCartographic.height
        const alpha = cloudOpacityForHeight({
          heightMeters: height,
          commanderOpacity: commanderOpacityRef.current,
          depthAuto: depthAutoRef.current,
        })
        const sat = saturationRef.current
        const threshold = colorToAlphaThresholdRef.current
        for (const hem of [eastRef.current, westRef.current]) {
          for (const slot of [hem.front, hem.back]) {
            if (!slot) continue
            if (typeof slot.layer.isDestroyed === 'function' && slot.layer.isDestroyed()) continue
            slot.layer.alpha = hem.front === slot ? alpha : slot.layer.alpha
            slot.layer.saturation = sat
            slot.layer.colorToAlphaThreshold = threshold
          }
        }
      }
      applyAlphaRef.current = applyAlpha
      const detachMovement = attachCameraMovementGate(targetViewer, moving => {
        movingRef.current = moving
        if (!moving) {
          applyAlpha()
          flushFramesRef.current?.()
        }
      })
      applyAlpha()
      removeCamera = () => {
        detachMovement()
      }
    })

    return () => {
      cancelled = true
      removeCamera?.()
      if (applyAlphaRef.current) applyAlphaRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    const generation = ++generationRef.current
    const stillCurrent = () => generation === generationRef.current && !targetViewer.isDestroyed()
    desiredEnabledRef.current = enabled
    desiredEastRef.current = eastFrame
    desiredWestRef.current = westFrame

    let cancelled = false
    const abortWaits: Array<() => void> = []

    void loadCesium().then(Cesium => {
      if (cancelled || !stillCurrent()) return

      const currentAlpha = () => cloudOpacityForHeight({
        heightMeters: targetViewer.isDestroyed() ? 8_000_000 : targetViewer.camera.positionCartographic.height,
        commanderOpacity: commanderOpacityRef.current,
        depthAuto: depthAutoRef.current,
      })

      const styleCloudLayer = (layer: ImageryLayer) => {
        layer.colorToAlpha = Cesium.Color.BLACK
        layer.colorToAlphaThreshold = colorToAlphaThresholdRef.current
        layer.saturation = saturationRef.current
      }

      const waitForTiles = (): Promise<void> => new Promise(resolve => {
        let settled = false
        let onProgress: ((remaining: number) => void) | null = null
        let timeout = 0
        let early = 0
        const finish = () => {
          if (settled) return
          settled = true
          window.clearTimeout(timeout)
          window.clearTimeout(early)
          if (onProgress) {
            try {
              targetViewer.scene.globe.tileLoadProgressEvent.removeEventListener(onProgress)
            } catch {
              /* viewer may already be destroyed */
            }
          }
          resolve()
        }
        abortWaits.push(finish)
        timeout = window.setTimeout(finish, 800)
        onProgress = (remaining: number) => {
          if (remaining > 0) return
          finish()
        }
        targetViewer.scene.globe.tileLoadProgressEvent.addEventListener(onProgress)
        early = window.setTimeout(() => {
          if (!settled && targetViewer.scene.globe.tilesLoaded) finish()
        }, 80)
      })

      const crossfade = (fromLayer: ImageryLayer, toLayer: ImageryLayer): Promise<void> => new Promise(resolve => {
        const started = performance.now()
        const fromStart = fromLayer.alpha
        const tick = (now: number) => {
          if (cancelled || !stillCurrent()) {
            resolve()
            return
          }
          const t = Math.min(1, (now - started) / TERRA_CLOUD_CROSSFADE_MS)
          const target = currentAlpha()
          fromLayer.alpha = fromStart * (1 - t)
          toLayer.alpha = target * t
          if (t < 1) {
            const handle = requestAnimationFrame(tick)
            fadeHandlesRef.current.push(handle)
            return
          }
          resolve()
        }
        const handle = requestAnimationFrame(tick)
        fadeHandlesRef.current.push(handle)
      })

      const applyFrame = async (hem: Hemisphere, frame: EarthPulseCloudFrame | null) => {
        if (movingRef.current) return
        if (!frame) {
          dropHemisphere(targetViewer, hem)
          return
        }
        if (hem.front?.url === frame.tileUrlTemplate) {
          hem.front.layer.show = true
          applyAlphaRef.current?.()
          return
        }
        if (hem.back?.url !== frame.tileUrlTemplate) {
          dropSlot(targetViewer, hem.back)
          hem.back = null
          if (!stillCurrent() || movingRef.current) return
          const provider = new Cesium.UrlTemplateImageryProvider({
            url: frame.tileUrlTemplate,
            maximumLevel: frame.maximumLevel,
            credit: new Cesium.Credit(`NASA GIBS · NOAA ${frame.satellite} ABI GeoColor ${frame.timestampIso}`),
          })
          if (!stillCurrent() || movingRef.current) return
          const layer = targetViewer.imageryLayers.addImageryProvider(provider)
          styleCloudLayer(layer)
          layer.alpha = hem.front ? 0 : currentAlpha()
          registerWeatherImageryLayer(targetViewer, 'clouds', layer)
          hem.back = { layer, url: frame.tileUrlTemplate }
        }
        const incoming = hem.back
        const outgoing = hem.front
        if (!incoming) return
        if (outgoing) {
          await waitForTiles()
          if (cancelled || !stillCurrent() || movingRef.current) return
          await crossfade(outgoing.layer, incoming.layer)
          if (cancelled || !stillCurrent() || movingRef.current) return
          if (hem.front === outgoing) {
            dropSlot(targetViewer, outgoing)
            hem.front = incoming
            if (hem.back === incoming) hem.back = null
          }
          ensureRadarBelowClouds(targetViewer)
          return
        }
        incoming.layer.alpha = currentAlpha()
        hem.front = incoming
        hem.back = null
        ensureRadarBelowClouds(targetViewer)
      }

      const applyDesired = () => {
        if (cancelled || !stillCurrent()) return
        if (movingRef.current) {
          if (!desiredEnabledRef.current) {
            hideHemisphere(eastRef.current)
            hideHemisphere(westRef.current)
          }
          return
        }
        if (!desiredEnabledRef.current) {
          dropHemisphere(targetViewer, eastRef.current)
          dropHemisphere(targetViewer, westRef.current)
          return
        }
        void applyFrame(eastRef.current, desiredEastRef.current).then(() => {
          if (cancelled || !stillCurrent() || movingRef.current) return
          return applyFrame(westRef.current, desiredWestRef.current)
        })
      }
      flushFramesRef.current = applyDesired
      applyDesired()
    })

    return () => {
      cancelled = true
      if (flushFramesRef.current) flushFramesRef.current = null
      for (const abort of abortWaits) abort()
    }
  }, [viewer, enabled, eastFrame?.tileUrlTemplate, westFrame?.tileUrlTemplate, eastFrame?.maximumLevel, westFrame?.maximumLevel, eastFrame?.timestampIso, westFrame?.timestampIso, eastFrame?.satellite, westFrame?.satellite])

  return null
}
