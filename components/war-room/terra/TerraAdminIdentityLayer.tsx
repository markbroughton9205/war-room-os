'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { releaseScenePrimitiveAfterRender } from './cesiumPrimitiveLifecycle'
import { loadCesium } from './loadCesiumRuntime'
import {
  ADMIN_IDENTITY_CREDIT,
  ADMIN_IDENTITY_DATA_PATHS,
  cityLabels,
  countryLabels,
  findActiveFeature,
  flagPublicPath,
  lookupFlagAsset,
  selectCountryFeatures,
  selectStateFeatures,
  stateLabels,
  type AdminCompactCollection,
  type AdminCompactFeature,
  type AdminIdentityPresentation,
  type AdminViewport,
} from '@/lib/terra/adminIdentity'
import { disputeDash } from '@/lib/terra/adminIdentity/disputed'
import { terraWorkerPool } from '@/lib/terra/worker/pool'
import { adminOpacityConverged } from '@/lib/terra/stability/featureEntityReuse'

const cache = new Map<string, Promise<AdminCompactCollection>>()

function loadCollection(url: string): Promise<AdminCompactCollection> {
  const existing = cache.get(url)
  if (existing) return existing
  const pending = fetch(url).then(async response => {
    if (!response.ok) throw new Error(`admin identity ${response.status}`)
    return response.json() as Promise<AdminCompactCollection>
  })
  cache.set(url, pending)
  return pending
}

function viewportFromViewer(viewer: CesiumViewer, Cesium: typeof import('cesium')): AdminViewport | null {
  try {
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
    if (!rect) return null
    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north),
    }
  } catch {
    return null
  }
}

function viewportKey(view: AdminViewport | null, lod: string): string {
  if (!view) return `none:${lod}`
  const step = lod === 'major' || lod === 'all' ? 8 : lod === 'primary' || lod === 'begin' ? 2 : 0.6
  const snap = (v: number) => Math.round(v / step) * step
  return `${lod}:${snap(view.west)}:${snap(view.south)}:${snap(view.east)}:${snap(view.north)}`
}

function flattenRing(ring: number[][], maxVertices = Number.POSITIVE_INFINITY): number[] {
  const out: number[] = []
  const stride = Math.max(1, Math.ceil(ring.length / maxVertices))
  for (let index = 0; index < ring.length; index += stride) {
    const [lon, lat] = ring[index]
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      out.push(lon, lat)
    }
  }
  if (ring.length > 1 && (ring.length - 1) % stride !== 0) {
    const [lon, lat] = ring[ring.length - 1]
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push(lon, lat)
  }
  return out
}

type Props = {
  viewer: CesiumViewer | null
  enabled: boolean
  presentation: AdminIdentityPresentation
  activeLatitude: number | null
  activeLongitude: number | null
}

export function TerraAdminIdentityLayer({
  viewer,
  enabled,
  presentation,
  activeLatitude,
  activeLongitude,
}: Props) {
  const presentationRef = useRef(presentation)
  const enabledRef = useRef(enabled)
  const activeLatitudeRef = useRef(activeLatitude)
  const activeLongitudeRef = useRef(activeLongitude)
  const scheduleRebuildRef = useRef<(() => void) | null>(null)
  const opacityRef = useRef({
    country: presentation.countryBorderOpacity,
    state: presentation.stateBorderOpacity,
    county: presentation.countyBorderOpacity,
    countryLabel: presentation.countryLabelOpacity,
    stateLabel: presentation.stateLabelOpacity,
    cityLabel: presentation.cityLabelOpacity,
    flag: Math.max(presentation.countryFlagOpacity, presentation.stateFlagOpacity),
  })

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const targetViewer = viewer
    let cancelled = false
    let dataSource: import('cesium').CustomDataSource | null = null
    let labels: import('cesium').LabelCollection | null = null
    let removeListener: (() => void) | null = null
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null
    let rebuildGeneration = 0
    let lastKey = ''
    let lastFlagKey = ''
    let flagEntity: import('cesium').Entity | null = null

    const countryEntities: import('cesium').Entity[] = []
    const stateEntities: import('cesium').Entity[] = []

    let cleanupPreRender: (() => void) | null = null
    void loadCesium().then(async Cesium => {
      if (cancelled || targetViewer.isDestroyed()) return
      dataSource = new Cesium.CustomDataSource('terra-admin-identity')
      await targetViewer.dataSources.add(dataSource)
      if (cancelled || targetViewer.isDestroyed()) {
        try {
          if (!targetViewer.isDestroyed()) targetViewer.dataSources.remove(dataSource, true)
        } catch { /* ignore */ }
        dataSource = null
        return
      }
      labels = new Cesium.LabelCollection({ scene: targetViewer.scene })
      targetViewer.scene.primitives.add(labels)
      dataSource.entities.add({
        id: 'terra-admin-identity-credit',
        description: ADMIN_IDENTITY_CREDIT,
      })
      const maxRingVertices = Math.max(2_048, Math.floor(terraWorkerPool().budget.maxVertices / 8))

      const lerp = (from: number, to: number, t: number) => from + (to - from) * t

      const applyOpacities = () => {
        if (!dataSource || targetViewer.isDestroyed()) return
        const next = presentationRef.current
        const cur = opacityRef.current
        if (adminOpacityConverged(cur, next)) return
        const t = 0.18
        cur.country = lerp(cur.country, next.countryBorderOpacity, t)
        cur.state = lerp(cur.state, next.stateBorderOpacity, t)
        cur.county = lerp(cur.county, next.countyBorderOpacity, t)
        cur.countryLabel = lerp(cur.countryLabel, next.countryLabelOpacity, t)
        cur.stateLabel = lerp(cur.stateLabel, next.stateLabelOpacity, t)
        cur.cityLabel = lerp(cur.cityLabel, next.cityLabelOpacity, t)
        cur.flag = lerp(cur.flag, Math.max(next.countryFlagOpacity, next.stateFlagOpacity), t)
        const countryColor = Cesium.Color.fromCssColorString('#e2e8f0').withAlpha(Math.max(0, cur.country))
        const stateColor = Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(Math.max(0, cur.state))
        for (const entity of countryEntities) {
          if (entity.polyline) entity.polyline.material = new Cesium.ColorMaterialProperty(countryColor)
        }
        for (const entity of stateEntities) {
          if (entity.polyline) entity.polyline.material = new Cesium.ColorMaterialProperty(stateColor)
        }
        if (flagEntity?.polygon) {
          const material = flagEntity.polygon.material
          if (material && 'color' in material) {
            ;(material as { color: { setValue?: (c: unknown) => void } }).color?.setValue?.(
              Cesium.Color.WHITE.withAlpha(Math.max(0, cur.flag)),
            )
          }
          flagEntity.show = cur.flag > 0.008
        }
        if (labels) {
          for (let i = 0; i < labels.length; i++) {
            const label = labels.get(i)
            const kind = (label.id as { kind?: string } | undefined)?.kind
            const alpha = kind === 'state' ? cur.stateLabel : kind === 'city' ? cur.cityLabel : cur.countryLabel
            label.fillColor = Cesium.Color.WHITE.withAlpha(Math.max(0, alpha))
            label.show = alpha > 0.05
          }
        }
      }

      const clearBorders = () => {
        if (!dataSource) return
        for (const entity of [...countryEntities, ...stateEntities]) {
          dataSource.entities.remove(entity)
        }
        countryEntities.length = 0
        stateEntities.length = 0
      }

      const addPolylines = (
        features: AdminCompactFeature[],
        bucket: import('cesium').Entity[],
        width: number,
        color: import('cesium').Color,
        prefix: string,
      ) => {
        if (!dataSource) return
        for (const feature of features) {
          for (let r = 0; r < feature.rings.length; r++) {
            const flat = flattenRing(feature.rings[r], maxRingVertices)
            if (flat.length < 6) continue
            try {
              const dash = disputeDash(feature)
              const entity = dataSource.entities.add({
                id: `${prefix}:${feature.id}:${r}`,
                name: feature.name,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(flat),
                  width,
                  clampToGround: true,
                  material: dash
                    ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 })
                    : color,
                  arcType: Cesium.ArcType.GEODESIC,
                },
              })
              bucket.push(entity)
            } catch {
              /* skip malformed ring */
            }
          }
        }
      }

      const rebuildLabels = (
        countryFeats: AdminCompactFeature[],
        stateFeats: AdminCompactFeature[],
        placeFeats: AdminCompactFeature[],
        view: AdminViewport | null,
        next: AdminIdentityPresentation,
      ) => {
        if (!labels) return
        labels.removeAll()
        const all = [
          ...countryLabels(countryFeats, next).map(row => ({ ...row })),
          ...stateLabels(stateFeats, next).map(row => ({ ...row })),
          ...cityLabels(placeFeats, next, view).map(row => ({ ...row })),
        ]
        for (const row of all) {
          const added = labels.add({
            id: { kind: row.kind, id: row.id },
            position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
            text: row.text,
            font: row.kind === 'country' ? 'bold 13px sans-serif' : row.kind === 'state' ? '12px sans-serif' : '11px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            scale: row.kind === 'country' ? 1 : 0.92,
          })
          added.show = true
        }
      }

      const rebuildFlag = (feature: AdminCompactFeature | null, next: AdminIdentityPresentation) => {
        if (!dataSource) return
        const key = `${next.flagTarget?.kind ?? 'none'}:${next.flagTarget?.isoCode ?? ''}:${feature?.id ?? ''}`
        if (key === lastFlagKey && flagEntity) return
        lastFlagKey = key
        if (flagEntity) {
          dataSource.entities.remove(flagEntity)
          flagEntity = null
        }
        if (!feature || !next.flagTarget) return
        const asset = lookupFlagAsset(next.flagTarget.isoCode, next.flagTarget.kind)
        if (!asset) return
        const hierarchyRings = feature.rings.map(ring => {
          const flat = flattenRing(ring, maxRingVertices)
          return Cesium.Cartesian3.fromDegreesArray(flat)
        }).filter(ring => ring.length >= 3)
        if (!hierarchyRings.length) return
        const holes = hierarchyRings.slice(1)
        try {
          flagEntity = dataSource.entities.add({
            id: 'terra-admin-identity-flag',
            name: asset.territoryName,
            polygon: {
              hierarchy: holes.length
                ? new Cesium.PolygonHierarchy(hierarchyRings[0], holes.map(hole => new Cesium.PolygonHierarchy(hole)))
                : hierarchyRings[0],
              material: new Cesium.ImageMaterialProperty({
                image: flagPublicPath(asset),
                transparent: true,
                color: Cesium.Color.WHITE.withAlpha(Math.max(next.countryFlagOpacity, next.stateFlagOpacity)),
              }),
              outline: false,
              classificationType: Cesium.ClassificationType.TERRAIN,
              height: undefined,
              extrudedHeight: undefined,
            },
          })
        } catch {
          flagEntity = null
        }
      }

      const rebuild = async () => {
        if (cancelled || !dataSource || targetViewer.isDestroyed()) return
        const generation = ++rebuildGeneration
        const next = presentationRef.current
        if (!enabledRef.current || next.layerEffective === 'HIDDEN') {
          clearBorders()
          labels?.removeAll()
          if (flagEntity && dataSource) {
            dataSource.entities.remove(flagEntity)
            flagEntity = null
            lastFlagKey = ''
          }
          lastKey = 'hidden'
          return
        }
        const view = viewportFromViewer(targetViewer, Cesium)
        const key = `${next.countryLod}:${next.stateLod}:${next.flagTarget?.isoCode ?? ''}:${viewportKey(view, next.stateLod)}:${next.hierarchy.countryCode ?? ''}`
        if (key === lastKey) {
          applyOpacities()
          return
        }
        lastKey = key
        const countries = await loadCollection(ADMIN_IDENTITY_DATA_PATHS.countries)
        if (cancelled || generation !== rebuildGeneration) return
        let admin1: AdminCompactCollection = { name: 'empty', provenanceId: 'natural_earth', version: '', license: '', featureCount: 0, features: [] }
        let places: AdminCompactCollection = { name: 'empty', provenanceId: 'natural_earth', version: '', license: '', featureCount: 0, features: [] }
        if (next.stateLod !== 'none') {
          admin1 = await loadCollection(ADMIN_IDENTITY_DATA_PATHS.admin1)
          if (cancelled || generation !== rebuildGeneration) return
        }
        if (next.cityLabelCap > 0) {
          places = await loadCollection(ADMIN_IDENTITY_DATA_PATHS.places)
          if (cancelled || generation !== rebuildGeneration) return
        }
        if (cancelled || generation !== rebuildGeneration || targetViewer.isDestroyed()) return
        const iso2 = next.hierarchy.countryCode
        const countryFeats = selectCountryFeatures(countries.features, next, view, iso2)
        const stateFeats = selectStateFeatures(
          admin1.features,
          next,
          view,
          countryFeats.find(f => f.iso2 === iso2)?.adm0 ?? null,
          next.hierarchy.stateCode,
        )
        clearBorders()
        addPolylines(
          countryFeats,
          countryEntities,
          next.countryBorderWidth,
          Cesium.Color.fromCssColorString('#e2e8f0').withAlpha(next.countryBorderOpacity),
          'country',
        )
        addPolylines(
          stateFeats,
          stateEntities,
          next.stateBorderWidth,
          Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(next.stateBorderOpacity),
          'state',
        )
        rebuildLabels(countryFeats, stateFeats, places.features, view, next)
        const flagPool = next.flagTarget?.kind === 'state' ? stateFeats : countryFeats
        const flagFeature = findActiveFeature(
          flagPool,
          next.flagTarget?.isoCode ?? null,
          activeLongitudeRef.current,
          activeLatitudeRef.current,
        )
        rebuildFlag(flagFeature, next)
        applyOpacities()
      }

      const scheduleRebuild = () => {
        rebuildGeneration += 1
        if (rebuildTimer) clearTimeout(rebuildTimer)
        rebuildTimer = setTimeout(() => { void rebuild() }, 180)
      }
      scheduleRebuildRef.current = scheduleRebuild

      removeListener = targetViewer.camera.moveEnd.addEventListener(scheduleRebuild)
      const removePreRender = targetViewer.scene.preRender.addEventListener(applyOpacities)
      await rebuild()
      cleanupPreRender = () => { removePreRender() }
    })

    return () => {
      cancelled = true
      scheduleRebuildRef.current = null
      if (rebuildTimer) clearTimeout(rebuildTimer)
      removeListener?.()
      cleanupPreRender?.()
      // Glyph BillboardCollection uniforms stay bound until the frame's command list
      // finishes. Removing here would null textureAtlas while u_atlas is still drawing.
      if (labels) releaseScenePrimitiveAfterRender(targetViewer, labels)
      try {
        if (dataSource && !targetViewer.isDestroyed()) targetViewer.dataSources.remove(dataSource, true)
      } catch { /* ignore */ }
    }
  }, [viewer, enabled])

  useEffect(() => {
    presentationRef.current = presentation
    enabledRef.current = enabled
    activeLatitudeRef.current = activeLatitude
    activeLongitudeRef.current = activeLongitude
  }, [presentation, enabled, activeLatitude, activeLongitude])

  useEffect(() => {
    scheduleRebuildRef.current?.()
  }, [enabled, presentation.countryLod, presentation.stateLod, presentation.flagTarget?.isoCode, presentation.hierarchy.countryCode, presentation.hierarchy.stateCode, activeLatitude, activeLongitude])

  return null
}
