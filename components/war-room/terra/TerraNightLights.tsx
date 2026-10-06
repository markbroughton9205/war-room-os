'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { buildGibsTileUrlTemplate } from '@/lib/earth-intelligence/gibsTileUrl'
import {
  TERRA_NIGHT_LIGHTS_COMPOSITE_DATE,
  TERRA_NIGHT_LIGHTS_CREDIT,
  TERRA_NIGHT_LIGHTS_DAILY_CREDIT,
  TERRA_NIGHT_LIGHTS_GIBS_LAYER_ID,
  TERRA_NIGHT_LIGHTS_MAX_LEVEL,
} from '@/lib/terra/nightLightsSource'
import { applyTerraGlobeSunLighting, type TerraNightLayerVisual } from '@/lib/terra/solarLighting'
import { CITY_LIGHT_TUNING } from '@/lib/terra/realisticEarth/cityLights'
import { releaseImageryLayerAfterRender } from './cesiumImageryLifecycle'
import { ensureWeatherRenderOrder } from './terraWeatherLayerStack'

/**
 * Night-side VIIRS Night Lights overlay. AUTO uses Cesium nightAlpha so only the sun-shadowed
 * hemisphere receives city lights. MANUAL DAY hides it. MANUAL NIGHT is a labeled preview.
 * Radar/weather layers stay independent (they raise themselves to top).
 */
export function TerraNightLights({
  viewer,
  visual,
  catalog,
  saturation = CITY_LIGHT_TUNING.saturation,
  brightness = CITY_LIGHT_TUNING.brightness,
  gamma = CITY_LIGHT_TUNING.gamma,
  contrast = CITY_LIGHT_TUNING.contrast,
  maximumLevel,
}: {
  viewer: CesiumViewer | null
  visual: TerraNightLayerVisual
  catalog?: { tileUrlTemplate: string; maximumLevel: number; mode: string; productDate: string } | null
  saturation?: number
  brightness?: number
  gamma?: number
  contrast?: number
  maximumLevel?: number
}) {
  const visualRef = useRef(visual)
  visualRef.current = visual
  const saturationRef = useRef(saturation)
  const brightnessRef = useRef(brightness)
  const gammaRef = useRef(gamma)
  const contrastRef = useRef(contrast)
  const applyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    saturationRef.current = saturation
    brightnessRef.current = brightness
    gammaRef.current = gamma
    contrastRef.current = contrast
    applyRef.current?.()
  }, [visual.enableLighting, visual.dayAlpha, visual.nightAlpha, visual.alpha, saturation, brightness, gamma, contrast])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    let cancelled = false
    let layer: import('cesium').ImageryLayer | null = null

    void loadCesium().then(Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return
      const url = catalog?.tileUrlTemplate ?? buildGibsTileUrlTemplate(TERRA_NIGHT_LIGHTS_GIBS_LAYER_ID, TERRA_NIGHT_LIGHTS_COMPOSITE_DATE)
      const credit = catalog?.mode === 'DAILY'
        ? `${TERRA_NIGHT_LIGHTS_DAILY_CREDIT} · ${catalog.productDate}`
        : TERRA_NIGHT_LIGHTS_CREDIT
      const provider = new Cesium.UrlTemplateImageryProvider({
        url,
        maximumLevel: maximumLevel ?? catalog?.maximumLevel ?? TERRA_NIGHT_LIGHTS_MAX_LEVEL,
        credit: new Cesium.Credit(credit),
      })
      layer = targetViewer.imageryLayers.addImageryProvider(provider)
      layer.colorToAlpha = Cesium.Color.BLACK
      layer.colorToAlphaThreshold = 0.15
      ensureWeatherRenderOrder(targetViewer)
      const apply = () => {
        if (!layer || targetViewer.isDestroyed()) return
        const next = visualRef.current
        layer.alpha = next.alpha
        layer.dayAlpha = next.dayAlpha
        layer.nightAlpha = next.nightAlpha
        layer.saturation = saturationRef.current
        layer.brightness = brightnessRef.current
        layer.gamma = gammaRef.current
        layer.contrast = contrastRef.current
        layer.colorToAlphaThreshold = CITY_LIGHT_TUNING.colorToAlphaThreshold
        const globe = targetViewer.scene.globe
        applyTerraGlobeSunLighting(globe, next.enableLighting)
        if (targetViewer.scene.skyAtmosphere) targetViewer.scene.skyAtmosphere.show = true
      }
      applyRef.current = apply
      apply()
    })

    return () => {
      cancelled = true
      applyRef.current = null
      if (!targetViewer.isDestroyed() && layer) {
        releaseImageryLayerAfterRender(targetViewer, layer)
      }
    }
  }, [viewer, catalog?.tileUrlTemplate, catalog?.mode, catalog?.productDate, catalog?.maximumLevel, maximumLevel])

  return null
}
