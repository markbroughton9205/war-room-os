'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewer as CesiumViewer } from 'cesium'
import { loadCesium } from './loadCesiumRuntime'
import { planCinematicFlyTo, type CinematicFlyDestination, type CinematicFlyPlan } from '@/lib/terra/cinematicFlyTo'
import {
  cameraSettledAtDestination,
  resolveCinematicFlightOutcome,
  type TerraCinematicFlightPurpose,
  type TerraCinematicFlightState,
} from '@/lib/terra/cinematicFlightOutcome'

export type TerraCinematicFlyOptions = {
  purpose?: TerraCinematicFlightPurpose
  label?: string
  onComplete?: () => void
}

export type TerraCinematicFlightResult = {
  flying: boolean
  outcome: TerraCinematicFlightState
  purpose: TerraCinematicFlightPurpose | null
  label: string
  lastPlan: CinematicFlyPlan | null
  flyTo: (
    destination: CinematicFlyDestination & { instantRequested?: boolean },
    onCompleteOrOptions?: (() => void) | TerraCinematicFlyOptions,
  ) => void
  cancel: () => void
}

function normalizeOptions(onCompleteOrOptions?: (() => void) | TerraCinematicFlyOptions): TerraCinematicFlyOptions {
  if (typeof onCompleteOrOptions === 'function') return { onComplete: onCompleteOrOptions }
  return onCompleteOrOptions ?? {}
}

export function useTerraCinematicFlight(
  viewer: CesiumViewer | null,
  prefersReducedMotion: boolean,
  hookOptions?: { onManualInterrupt?: () => void; onFlightStart?: () => void },
): TerraCinematicFlightResult {
  const [flying, setFlying] = useState(false)
  const [outcome, setOutcome] = useState<TerraCinematicFlightState>('IDLE')
  const [purpose, setPurpose] = useState<TerraCinematicFlightPurpose | null>(null)
  const [label, setLabel] = useState('')
  const [lastPlan, setLastPlan] = useState<CinematicFlyPlan | null>(null)
  const generationRef = useRef(0)
  const flyingRef = useRef(false)
  const interruptRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onManualInterruptRef = useRef(hookOptions?.onManualInterrupt)
  onManualInterruptRef.current = hookOptions?.onManualInterrupt
  const onFlightStartRef = useRef(hookOptions?.onFlightStart)
  onFlightStartRef.current = hookOptions?.onFlightStart

  const finish = useCallback((next: TerraCinematicFlightState) => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    flyingRef.current = false
    setFlying(false)
    setOutcome(next)
  }, [])

  const cancel = useCallback(() => {
    interruptRef.current = false
    generationRef.current += 1
    if (viewer && !viewer.isDestroyed()) viewer.camera.cancelFlight()
    finish('CANCELLED')
  }, [finish, viewer])

  const flyTo = useCallback((
    destination: CinematicFlyDestination & { instantRequested?: boolean },
    onCompleteOrOptions?: (() => void) | TerraCinematicFlyOptions,
  ) => {
    if (!viewer || viewer.isDestroyed()) {
      finish('FAILED')
      return
    }
    const options = normalizeOptions(onCompleteOrOptions)
    interruptRef.current = false
    const generation = generationRef.current + 1
    generationRef.current = generation
    flyingRef.current = true
    setFlying(true)
    setOutcome('FLYING')
    onFlightStartRef.current?.()
    setPurpose(options.purpose ?? (destination.instantRequested ? 'jump' : 'search'))
    setLabel(options.label ?? '')
    void loadCesium().then(Cesium => {
      if (generation !== generationRef.current || viewer.isDestroyed()) return
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC)
      const from = {
        longitude: Cesium.Math.toDegrees(carto.longitude),
        latitude: Cesium.Math.toDegrees(carto.latitude),
        heightMeters: carto.height,
      }
      const plan = planCinematicFlyTo({
        from,
        to: destination,
        prefersReducedMotion,
        instantRequested: Boolean(destination.instantRequested),
      })
      setLastPlan(plan)
      const cesiumDestination = plan.destination.kind === 'rectangle'
        ? Cesium.Rectangle.fromDegrees(plan.destination.west, plan.destination.south, plan.destination.east, plan.destination.north)
        : Cesium.Cartesian3.fromDegrees(plan.destination.longitude, plan.destination.latitude, plan.destination.heightMeters)
      viewer.camera.cancelFlight()
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        if (generation !== generationRef.current || !flyingRef.current) return
        generationRef.current += 1
        if (!viewer.isDestroyed()) viewer.camera.cancelFlight()
        finish('FAILED')
      }, Math.round((plan.durationSeconds + 4) * 1000))
      const orientation = plan.pitchDegrees != null || plan.headingDegrees != null
        ? {
          heading: plan.headingDegrees != null ? Cesium.Math.toRadians(plan.headingDegrees) : viewer.camera.heading,
          pitch: plan.pitchDegrees != null ? Cesium.Math.toRadians(plan.pitchDegrees) : viewer.camera.pitch,
          roll: 0,
        }
        : undefined
      viewer.camera.flyTo({
        destination: cesiumDestination,
        duration: plan.durationSeconds,
        maximumHeight: plan.maximumHeightMeters ?? undefined,
        flyOverLongitude: plan.flyOverLongitude != null ? Cesium.Math.toRadians(plan.flyOverLongitude) : undefined,
        pitchAdjustHeight: plan.pitchAdjustHeightMeters ?? undefined,
        orientation,
        complete: () => {
          const settleAndFinish = (attempt: number) => {
            requestAnimationFrame(() => {
              if (generation !== generationRef.current) return
              if (viewer.isDestroyed()) return
              if (interruptRef.current) {
                finish('INTERRUPTED')
                return
              }
              const now = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC)
              const camera = {
                longitude: Cesium.Math.toDegrees(now.longitude),
                latitude: Cesium.Math.toDegrees(now.latitude),
                heightMeters: now.height,
              }
              const settled = cameraSettledAtDestination(camera, plan.destination, { instant: plan.mode === 'instant' })
              if (!settled && attempt < 24) {
                settleAndFinish(attempt + 1)
                return
              }
              const next = resolveCinematicFlightOutcome({
                generationMatches: true,
                completeFired: true,
                cancelled: false,
                interrupted: false,
                superseded: false,
                settled,
              })
              finish(next)
              if (next === 'ARRIVED') options.onComplete?.()
            })
          }
          settleAndFinish(0)
        },
        cancel: () => {
          const next = resolveCinematicFlightOutcome({
            generationMatches: generation === generationRef.current,
            completeFired: false,
            cancelled: true,
            interrupted: interruptRef.current,
            superseded: generation !== generationRef.current,
            settled: false,
          })
          if (generation !== generationRef.current) return
          finish(next)
        },
      })
    }).catch(() => {
      if (generation !== generationRef.current) return
      finish('FAILED')
    })
  }, [finish, prefersReducedMotion, viewer])

  useEffect(() => {
    if (!viewer) return
    const canvas = viewer.scene.canvas
    const onInteract = () => {
      if (!flyingRef.current) return
      interruptRef.current = true
      generationRef.current += 1
      if (!viewer.isDestroyed()) viewer.camera.cancelFlight()
      finish('INTERRUPTED')
      onManualInterruptRef.current?.()
    }
    canvas.addEventListener('pointerdown', onInteract)
    canvas.addEventListener('wheel', onInteract, { passive: true })
    canvas.addEventListener('touchstart', onInteract, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', onInteract)
      canvas.removeEventListener('wheel', onInteract)
      canvas.removeEventListener('touchstart', onInteract)
    }
  }, [finish, viewer])

  useEffect(() => () => {
    generationRef.current += 1
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    if (viewer && !viewer.isDestroyed()) viewer.camera.cancelFlight()
  }, [viewer])

  return { flying, outcome, purpose, label, lastPlan, flyTo, cancel }
}
