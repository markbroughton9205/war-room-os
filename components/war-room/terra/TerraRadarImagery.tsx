'use client'

import { useEffect, useRef } from 'react'
import type { ImageryLayer, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { RADAR_MAX_TILE_LEVEL } from '@/lib/terra/weather'
import { radarOpacityForHeight } from '@/lib/terra/weather/atmosphere'
import { attachCameraMovementGate, hideImageryLayer, releaseImageryLayerAfterRender } from './cesiumImageryLifecycle'
import { ensureRadarBelowClouds, registerWeatherImageryLayer, unregisterWeatherImageryLayer } from './terraWeatherLayerStack'

const RADAR_CROSSFADE_MS = 350

type Slot = { layer: ImageryLayer; url: string }

function dropSlot(viewer: CesiumViewer, slot: Slot | null): void {
  if (!slot || viewer.isDestroyed()) return
  unregisterWeatherImageryLayer(viewer, slot.layer)
  releaseImageryLayerAfterRender(viewer, slot.layer)
}

export function TerraRadarImagery({
  viewer,
  enabled,
  urlTemplate,
  commanderOpacity = 1,
  depthAuto = true,
}: {
  viewer: CesiumViewer | null
  enabled: boolean
  urlTemplate: string | null
  commanderOpacity?: number
  depthAuto?: boolean
}) {
  const frontRef = useRef<Slot | null>(null)
  const backRef = useRef<Slot | null>(null)
  const generationRef = useRef(0)
  const fadeHandlesRef = useRef<number[]>([])
  const commanderOpacityRef = useRef(commanderOpacity)
  const depthAutoRef = useRef(depthAuto)
  const applyAlphaRef = useRef<(() => void) | null>(null)
  const movingRef = useRef(false)
  const desiredEnabledRef = useRef(enabled)
  const desiredUrlRef = useRef<string | null>(urlTemplate)
  const flushRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    commanderOpacityRef.current = commanderOpacity
    depthAutoRef.current = depthAuto
    applyAlphaRef.current?.()
  }, [commanderOpacity, depthAuto])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    let cancelled = false
    let removeCamera: (() => void) | null = null
    void loadCesium().then(() => {
      if (cancelled || targetViewer.isDestroyed()) return
      const applyAlpha = () => {
        if (targetViewer.isDestroyed()) return
        const alpha = radarOpacityForHeight({
          heightMeters: targetViewer.camera.positionCartographic.height,
          commanderOpacity: commanderOpacityRef.current,
          depthAuto: depthAutoRef.current,
        })
        if (frontRef.current && !(typeof frontRef.current.layer.isDestroyed === 'function' && frontRef.current.layer.isDestroyed())) {
          frontRef.current.layer.alpha = alpha
        }
      }
      applyAlphaRef.current = applyAlpha
      targetViewer.camera.changed.addEventListener(applyAlpha)
      const detachMovement = attachCameraMovementGate(targetViewer, moving => {
        movingRef.current = moving
        if (!moving) flushRef.current?.()
      })
      applyAlpha()
      removeCamera = () => {
        detachMovement()
        if (!targetViewer.isDestroyed()) targetViewer.camera.changed.removeEventListener(applyAlpha)
      }
    })
    return () => {
      cancelled = true
      removeCamera?.()
      applyAlphaRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    const generation = ++generationRef.current
    const stillCurrent = () => generation === generationRef.current && !targetViewer.isDestroyed()
    desiredEnabledRef.current = enabled
    desiredUrlRef.current = urlTemplate

    let cancelled = false
    void loadCesium().then(Cesium => {
      if (cancelled || !stillCurrent()) return
      const currentAlpha = () => radarOpacityForHeight({
        heightMeters: targetViewer.isDestroyed() ? 8_000_000 : targetViewer.camera.positionCartographic.height,
        commanderOpacity: commanderOpacityRef.current,
        depthAuto: depthAutoRef.current,
      })

      const applyDesired = () => {
        if (cancelled || !stillCurrent()) return
        const nextEnabled = desiredEnabledRef.current
        const nextUrl = desiredUrlRef.current
        if (movingRef.current) {
          if (!nextEnabled || !nextUrl) {
            hideImageryLayer(frontRef.current?.layer)
            hideImageryLayer(backRef.current?.layer)
          }
          return
        }
        if (!nextEnabled || !nextUrl) {
          dropSlot(targetViewer, frontRef.current)
          dropSlot(targetViewer, backRef.current)
          frontRef.current = null
          backRef.current = null
          return
        }
        if (frontRef.current?.url === nextUrl) {
          if (frontRef.current) {
            frontRef.current.layer.show = true
            frontRef.current.layer.alpha = currentAlpha()
          }
          ensureRadarBelowClouds(targetViewer)
          return
        }
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: nextUrl,
          maximumLevel: RADAR_MAX_TILE_LEVEL,
          tileWidth: 256,
          tileHeight: 256,
          credit: new Cesium.Credit('IEM / Iowa State University · NOAA/NWS NEXRAD'),
        })
        const incoming = targetViewer.imageryLayers.addImageryProvider(provider)
        incoming.alpha = frontRef.current ? 0 : currentAlpha()
        registerWeatherImageryLayer(targetViewer, 'radar', incoming)
        dropSlot(targetViewer, backRef.current)
        backRef.current = { layer: incoming, url: nextUrl }

        const outgoing = frontRef.current
        if (!outgoing) {
          frontRef.current = backRef.current
          backRef.current = null
          ensureRadarBelowClouds(targetViewer)
          return
        }

        const started = performance.now()
        const fromStart = outgoing.layer.alpha
        const tick = (now: number) => {
          if (cancelled || !stillCurrent() || movingRef.current) return
          const t = Math.min(1, (now - started) / RADAR_CROSSFADE_MS)
          const target = currentAlpha()
          outgoing.layer.alpha = fromStart * (1 - t)
          incoming.alpha = target * t
          if (t < 1) {
            const handle = requestAnimationFrame(tick)
            fadeHandlesRef.current.push(handle)
            return
          }
          if (frontRef.current === outgoing) {
            dropSlot(targetViewer, outgoing)
            frontRef.current = backRef.current
            backRef.current = null
          }
          ensureRadarBelowClouds(targetViewer)
        }
        const handle = requestAnimationFrame(tick)
        fadeHandlesRef.current.push(handle)
      }
      flushRef.current = applyDesired
      applyDesired()
    })

    return () => {
      cancelled = true
      if (flushRef.current) flushRef.current = null
      for (const handle of fadeHandlesRef.current) cancelAnimationFrame(handle)
      fadeHandlesRef.current = []
    }
  }, [viewer, enabled, urlTemplate])

  useEffect(() => {
    return () => {
      if (!viewer || viewer.isDestroyed()) return
      dropSlot(viewer, frontRef.current)
      dropSlot(viewer, backRef.current)
      frontRef.current = null
      backRef.current = null
    }
  }, [viewer])

  return null
}
