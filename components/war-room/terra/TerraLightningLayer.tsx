'use client'

import { useEffect, useRef, useState } from 'react'
import type { CustomDataSource, Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { EarthPulseLightningFlash } from '@/lib/terra/earthPulse'
import {
  TERRA_LIGHTNING_FLASH_MS,
  prefersTerraReducedMotion,
  selectLightningVisuals,
} from '@/lib/terra/earthPulse'

/**
 * White-dot root cause was this layer: a repeating CallbackProperty strobe on GLM cells.
 * GLM data stays in Earth Pulse status. Presentation is a one-shot cyan flash (or static close-in
 * marker under reduced motion), then the entity is removed.
 */
export function TerraLightningLayer({
  viewer,
  flashes,
  enabled,
  globalLod,
  cap,
}: {
  viewer: CesiumViewer | null
  flashes: EarthPulseLightningFlash[]
  enabled: boolean
  globalLod: boolean
  cap?: number
}) {
  const dataSourceRef = useRef<CustomDataSource | null>(null)
  const playedRef = useRef(new Set<string>())
  const timersRef = useRef<number[]>([])
  const [sourceEpoch, setSourceEpoch] = useState(0)

  useEffect(() => {
    if (!viewer) return
    const targetViewer = viewer
    let cancelled = false
    let created: CustomDataSource | null = null
    void loadCesium().then(Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return
      created = new Cesium.CustomDataSource('terra-earth-pulse-lightning')
      targetViewer.dataSources.add(created)
      dataSourceRef.current = created
      setSourceEpoch(value => value + 1)
    })
    return () => {
      cancelled = true
      for (const timer of timersRef.current) window.clearTimeout(timer)
      timersRef.current = []
      if (created && !targetViewer.isDestroyed()) targetViewer.dataSources.remove(created, true)
      if (dataSourceRef.current === created) dataSourceRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource) return
    let cancelled = false
    if (!enabled) {
      dataSource.entities.removeAll()
      playedRef.current.clear()
      return
    }

    void loadCesium().then(Cesium => {
      if (cancelled) return
      const reducedMotion = prefersTerraReducedMotion()
      const visible = selectLightningVisuals({
        flashes,
        nowIso: new Date().toISOString(),
        globalLod,
        reducedMotion,
        cap,
      })
      const visibleKeys = new Set(visible.map(flash => `${flash.id}:${flash.observedAt}`))
      for (const key of playedRef.current) {
        if (!visibleKeys.has(key)) playedRef.current.delete(key)
      }

      if (reducedMotion) {
        dataSource.entities.removeAll()
        for (const flash of visible) {
          dataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(flash.longitude, flash.latitude),
            point: {
              pixelSize: 3,
              color: Cesium.Color.fromCssColorString('#22D3EE').withAlpha(0.45),
              outlineWidth: 0,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        }
        return
      }

      for (const flash of visible) {
        const key = `${flash.id}:${flash.observedAt}`
        if (playedRef.current.has(key)) continue
        playedRef.current.add(key)
        const started = Date.now()
        const size = Math.min(7, 2.4 + Math.log2(1 + flash.count))
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(flash.longitude, flash.latitude),
          point: {
            pixelSize: new Cesium.CallbackProperty(() => {
              const t = Date.now() - started
              if (t >= TERRA_LIGHTNING_FLASH_MS) return 0
              const p = 1 - t / TERRA_LIGHTNING_FLASH_MS
              return size * (0.35 + p)
            }, false),
            color: new Cesium.CallbackProperty(() => {
              const t = Date.now() - started
              const p = Math.max(0, 1 - t / TERRA_LIGHTNING_FLASH_MS)
              return Cesium.Color.fromCssColorString('#67E8F9').withAlpha(0.15 + p * 0.7)
            }, false),
            outlineWidth: 0,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        const timer = window.setTimeout(() => {
          timersRef.current = timersRef.current.filter(id => id !== timer)
          if (!cancelled && dataSource.entities.contains(entity)) dataSource.entities.remove(entity)
        }, TERRA_LIGHTNING_FLASH_MS + 50)
        timersRef.current.push(timer)
      }
    })
    return () => { cancelled = true }
  }, [flashes, enabled, globalLod, cap, sourceEpoch])

  return null
}
