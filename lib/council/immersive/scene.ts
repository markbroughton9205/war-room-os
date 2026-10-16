/**
 * Renderer-agnostic scene model for the immersive Council. The desktop view and a future WebXR (Meta Quest 3S) view both read this:
 * the layout (planets, panel anchors, seated comfort limits) is defined once, in metres, with the viewer at the origin facing -Z.
 * This is a foundation only: nothing here claims headset acceptance, and `xrReadiness` reports capability detection, not a tested device.
 */
import type { PlanetId } from './planets'

export type Vec3 = { x: number; y: number; z: number }
export type ScenePlanet = { id: PlanetId; label: string; position: Vec3; radiusM: number; azimuthDeg: number; elevationDeg: number; distanceM: number }
export type ScenePanel = { id: string; label: string; azimuthDeg: number; elevationDeg: number; distanceM: number; widthM: number; heightM: number }

export type SceneModel = {
  seated: true
  eyeHeightM: number
  /** Seated operation: no walking, no artificial locomotion; the viewer turns (snap) and points. */
  locomotion: 'none'
  environments: Array<'deep_space' | 'white_room'>
  planets: ScenePlanet[]
  panels: ScenePanel[]
  input: { pointer: 'controller_ray'; select: string; back: string; turn: string; recenter: string; desktopEquivalents: Record<string, string> }
  comfort: { snapTurnDeg: number; vignetteOnTurn: boolean; reducedMotionDefault: boolean; maxPanelDistanceM: number }
}

const EYE = 1.2
const place = (azimuthDeg: number, elevationDeg: number, distanceM: number): Vec3 => {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return { x: distanceM * Math.cos(el) * Math.sin(az), y: EYE + distanceM * Math.sin(el), z: -distanceM * Math.cos(el) * Math.cos(az) }
}

export function buildSceneModel(): SceneModel {
  const planet = (id: PlanetId, label: string, azimuthDeg: number, elevationDeg: number, distanceM: number, radiusM: number): ScenePlanet =>
    ({ id, label, azimuthDeg, elevationDeg, distanceM, radiusM, position: place(azimuthDeg, elevationDeg, distanceM) })
  return {
    seated: true,
    eyeHeightM: EYE,
    locomotion: 'none',
    environments: ['deep_space', 'white_room'],
    planets: [
      planet('foundry', 'Foundry', -48, 6, 7, 0.9),
      planet('terra', 'Terra', 0, 14, 9, 1.4),
      planet('hvs', 'Higher Vision Studios', 48, 6, 7, 0.9),
    ],
    panels: [
      { id: 'conversation', label: 'Council conversation', azimuthDeg: 0, elevationDeg: -14, distanceM: 1.6, widthM: 1.5, heightM: 0.7 },
      { id: 'input', label: 'Commander input', azimuthDeg: 0, elevationDeg: -30, distanceM: 1.2, widthM: 0.8, heightM: 0.18 },
      { id: 'sessions', label: 'Sessions / Trash / Archive', azimuthDeg: -38, elevationDeg: -4, distanceM: 1.5, widthM: 0.9, heightM: 1.0 },
      { id: 'missions', label: 'Foundry missions', azimuthDeg: 38, elevationDeg: -4, distanceM: 1.5, widthM: 0.9, heightM: 1.0 },
      { id: 'systems', label: 'Connected systems', azimuthDeg: 60, elevationDeg: -2, distanceM: 1.6, widthM: 0.8, heightM: 0.8 },
      { id: 'computer', label: 'Council computer', azimuthDeg: -62, elevationDeg: -2, distanceM: 1.7, widthM: 1.1, heightM: 0.8 },
    ],
    input: {
      pointer: 'controller_ray',
      select: 'trigger (activate / press)',
      back: 'B / Y button (close the open panel)',
      turn: 'thumbstick left/right (snap turn)',
      recenter: 'hold the Meta button (system recenter)',
      desktopEquivalents: { select: 'click / Enter', back: 'Escape', turn: 'arrow keys / drag', recenter: 'Home' },
    },
    comfort: { snapTurnDeg: 30, vignetteOnTurn: true, reducedMotionDefault: true, maxPanelDistanceM: 2.5 },
  }
}

export type XrReadiness = { state: 'NOT_AVAILABLE' | 'SUPPORTED_BY_BROWSER'; note: string }

/** Capability detection only. `immersiveVrSupported` comes from navigator.xr.isSessionSupported('immersive-vr'). */
export function xrReadiness(input: { hasXr: boolean; immersiveVrSupported?: boolean }): XrReadiness {
  if (!input.hasXr) return { state: 'NOT_AVAILABLE', note: 'This browser/runtime exposes no WebXR API. VR entry is not available here.' }
  if (!input.immersiveVrSupported) return { state: 'NOT_AVAILABLE', note: 'WebXR is present but no immersive VR device/session is available.' }
  return { state: 'SUPPORTED_BY_BROWSER', note: 'The runtime reports immersive VR support. The VR scene has not been tested on a headset; do not treat this as headset acceptance.' }
}
