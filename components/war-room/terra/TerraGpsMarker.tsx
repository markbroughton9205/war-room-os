'use client'

import { useEffect, useRef } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import type { CommanderLocation } from '@/lib/terra/commanderLocation'

export function TerraGpsMarker({
  viewer,
  location,
  visible,
}: {
  viewer: CesiumViewer | null
  location: CommanderLocation | null
  visible: boolean
}) {
  const idsRef = useRef<{ point: string; radius: string; heading: string } | null>(null)

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    let cancelled = false
    void loadCesium().then(Cesium => {
      if (cancelled || viewer.isDestroyed()) return
      if (!idsRef.current) {
        const point = viewer.entities.add({
          id: 'terra-commander-you',
          name: 'YOU',
          label: {
            text: 'YOU',
            font: 'bold 11px sans-serif',
            fillColor: Cesium.Color.fromCssColorString('#ecfdf5'),
            outlineColor: Cesium.Color.fromCssColorString('#022c22'),
            outlineWidth: 3,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString('#10b981'),
            outlineColor: Cesium.Color.fromCssColorString('#fbbf24'),
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        const radius = viewer.entities.add({
          id: 'terra-commander-accuracy',
          name: 'Commander accuracy',
          ellipse: {
            material: Cesium.Color.fromCssColorString('#10b981').withAlpha(0.14),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.7),
            height: 0,
          },
        })
        const heading = viewer.entities.add({
          id: 'terra-commander-heading',
          name: 'Commander heading',
          polyline: {
            width: 3,
            material: Cesium.Color.fromCssColorString('#fbbf24'),
            clampToGround: true,
          },
        })
        idsRef.current = { point: String(point.id), radius: String(radius.id), heading: String(heading.id) }
      }
      const point = viewer.entities.getById(idsRef.current.point)
      const radius = viewer.entities.getById(idsRef.current.radius)
      const heading = viewer.entities.getById(idsRef.current.heading)
      const show = Boolean(visible && location)
      if (point) {
        point.show = show
        if (location) {
          point.position = Cesium.Cartesian3.fromDegrees(location.lon, location.lat, location.altitude ?? 0) as never
        }
      }
      if (radius) {
        radius.show = show && Boolean(location?.accuracyMeters && location.accuracyMeters > 0)
        if (location) {
          radius.position = Cesium.Cartesian3.fromDegrees(location.lon, location.lat, 0) as never
          if (radius.ellipse) {
            const meters = Math.max(location.accuracyMeters ?? 0, 8)
            radius.ellipse.semiMajorAxis = meters as never
            radius.ellipse.semiMinorAxis = meters as never
          }
        }
      }
      if (heading) {
        const hasHeading = show && location?.heading != null && Number.isFinite(location.heading)
        heading.show = Boolean(hasHeading)
        if (hasHeading && location && heading.polyline) {
          const headingDeg = location.heading
          if (headingDeg == null) return
          const radians = (headingDeg * Math.PI) / 180
          const lengthDeg = 0.00035
          const destLon = location.lon + (Math.sin(radians) * lengthDeg) / Math.cos((location.lat * Math.PI) / 180)
          const destLat = location.lat + Math.cos(radians) * lengthDeg
          heading.polyline.positions = Cesium.Cartesian3.fromDegreesArray([
            location.lon, location.lat, destLon, destLat,
          ]) as never
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [location, viewer, visible])

  useEffect(() => () => {
    if (!viewer || viewer.isDestroyed() || !idsRef.current) return
    viewer.entities.removeById(idsRef.current.point)
    viewer.entities.removeById(idsRef.current.radius)
    viewer.entities.removeById(idsRef.current.heading)
    idsRef.current = null
  }, [viewer])

  return null
}
