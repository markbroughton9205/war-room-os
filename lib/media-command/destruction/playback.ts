import type { HvsCameraFxCue, HvsSupportClass, HvsVolumeCue, Vec3 } from './types'

export type PlaybackFrame = { x: number; y: number; z: number; tilt: number }

export type PlaybackNode = {
  id: string
  role: 'PRIMARY_CHUNKS' | 'SECONDARY_DEBRIS'
  supportClass: HvsSupportClass | 'NONE'
  size: Vec3
  frames: PlaybackFrame[]
}

export type PlaybackCamera = {
  id: string
  position: Vec3
  lookAt: Vec3
  fov: number
}

export type HvsDestructionPlayback = {
  schemaVersion: 1
  summary: string
  fps: number
  durationSec: number
  frameCount: number
  cacheManifestId: string
  transformHash: string
  simulationRuns: number
  camera: PlaybackCamera
  nodes: PlaybackNode[]
  volumeCues: HvsVolumeCue[]
  cameraCues: HvsCameraFxCue[]
  volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE' | 'OPEN_VDB_TINY'
  fractureBackend: string
  physicsBackend: string
}

export const DESTRUCTION_CAMERAS: Record<'front' | 'three-quarter', PlaybackCamera> = {
  front: { id: 'cam-front', position: { x: 0, y: 1.7, z: 9 }, lookAt: { x: 0, y: 1.35, z: 0 }, fov: 38 },
  'three-quarter': { id: 'cam-three-quarter', position: { x: 7.2, y: 2.4, z: 6.4 }, lookAt: { x: 0, y: 1.2, z: 0 }, fov: 42 },
}

export function sampleNode(node: PlaybackNode, frame: number): PlaybackFrame {
  const index = Math.max(0, Math.min(node.frames.length - 1, frame))
  return node.frames[index] ?? { x: 0, y: 0, z: 0, tilt: 0 }
}
