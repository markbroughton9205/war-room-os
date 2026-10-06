import type { CameraSpec, VirtualCamera } from '../types'
import type { Hvs3DCamera, Hvs3DScene, HvsCameraMotionPreset } from './types'
import { nid } from './types'

const PRESET_TO_SPEC: Record<HvsCameraMotionPreset, CameraSpec['movement']> = {
  STATIC: 'static',
  PAN: 'pan',
  TILT: 'tilt',
  PUSH_IN: 'dolly',
  PULL_OUT: 'dolly',
  DOLLY: 'dolly',
  TRUCK: 'dolly',
  PEDESTAL: 'dolly',
  ORBIT: 'orbit',
  CRANE: 'orbit',
  ARC: 'orbit',
  HANDHELD_STYLE: 'handheld',
  FOLLOW: 'follow',
  REVEAL: 'dolly',
  CUSTOM_PATH: 'orbit',
}

export function camera3DToSpec(camera: Hvs3DCamera): CameraSpec {
  return {
    id: camera.cameraSpecId ?? nid('camspec'),
    name: camera.name,
    shotSize: camera.shotSize,
    angle: camera.angle,
    movement: PRESET_TO_SPEC[camera.movement] ?? 'orbit',
    framing: camera.virtualCameraMode,
    subjectTargetId: camera.target && camera.target.kind !== 'WORLD'
      ? (camera.target.kind === 'NODE' ? camera.target.nodeId : camera.target.characterId)
      : null,
    lensIntent: `${camera.focalLength}mm`,
    depthOfField: camera.apertureIntent === 'open' ? 'shallow' : camera.apertureIntent === 'closed' ? 'deep' : 'medium',
    trackingBehavior: camera.target ? 'FOLLOW SUBJECT' : null,
    trajectory: camera.pathId,
  }
}

export function camera3DToVirtualMode(camera: Hvs3DCamera): VirtualCamera['mode'] {
  return camera.virtualCameraMode
}

export function attachCameraBridge(scene: Hvs3DScene): { specs: CameraSpec[]; modes: VirtualCamera['mode'][] } {
  return {
    specs: scene.cameras.map(camera3DToSpec),
    modes: scene.cameras.map(camera3DToVirtualMode),
  }
}
