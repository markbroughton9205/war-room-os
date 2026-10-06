import type { CameraSpec } from '../types'
import type { HvsCameraPath, HvsShot } from './types'
import {
  type CameraControlCapability,
  type CameraHonesty,
  type CompiledCameraBackend,
} from './types'
import { pathChangesFocalLength, pathChangesPosition } from './path'

export type CinemaCompileBackend = 'hvs-3d' | 'three.js' | 'blender' | 'prompt'

const BACKEND_CAPS: Record<CinemaCompileBackend, { honesty: CameraHonesty; capabilities: CameraControlCapability[] }> = {
  'hvs-3d': { honesty: 'GEOMETRIC', capabilities: ['FULL_3D_CAMERA', 'KEYFRAME', 'TRAJECTORY'] },
  'three.js': { honesty: 'GEOMETRIC', capabilities: ['FULL_3D_CAMERA', 'KEYFRAME', 'TRAJECTORY'] },
  blender: { honesty: 'GEOMETRIC', capabilities: ['FULL_3D_CAMERA', 'KEYFRAME', 'TRAJECTORY'] },
  prompt: { honesty: 'PROMPT_APPROXIMATION', capabilities: ['PROMPT_ONLY'] },
}

export function promptTokensForShot(shot: HvsShot): string[] {
  const tokens = [
    shot.shotSize.replace(/_/g, ' ').toLowerCase(),
    shot.cameraAngle.replace(/_/g, ' ').toLowerCase(),
    `${shot.cameraSpec.focalLengthMm ?? 35}mm`,
    shot.cameraMovement.replace(/_/g, ' ').toLowerCase(),
    shot.framing.replace(/_/g, ' ').toLowerCase(),
  ]
  if (shot.relativePlacement) tokens.push(shot.relativePlacement.replace(/_/g, ' ').toLowerCase())
  return tokens
}

export function compileCameraSpecForBackend(
  spec: CameraSpec,
  backend: CinemaCompileBackend,
  extras?: { shot?: HvsShot; path?: HvsCameraPath },
): CompiledCameraBackend {
  const meta = BACKEND_CAPS[backend]
  if (backend === 'prompt') {
    return {
      backend,
      honesty: 'PROMPT_APPROXIMATION',
      capabilities: ['PROMPT_ONLY'],
      payload: { providerBinding: backend, compiledProviderPayload: extras?.shot ? promptTokensForShot(extras.shot) : [spec.lensIntent] },
      promptTokens: extras?.shot ? promptTokensForShot(extras.shot) : [spec.lensIntent, spec.movement],
    }
  }
  const payload: Record<string, unknown> = {
    cameraSpecId: spec.id,
    position: spec.position ?? extras?.path?.points[0]?.position ?? null,
    target: spec.target ?? extras?.path?.points[0]?.target ?? null,
    focalLengthMm: spec.focalLengthMm ?? null,
    movementType: spec.movementType ?? spec.movement,
    path: extras?.path ?? null,
    dollyNotZoom: extras?.shot?.cameraMovement === 'DOLLY_IN' || extras?.shot?.cameraMovement === 'DOLLY_OUT',
    zoomNotDolly: extras?.shot?.cameraMovement === 'ZOOM_IN' || extras?.shot?.cameraMovement === 'ZOOM_OUT',
    pathChangesPosition: extras?.path ? pathChangesPosition(extras.path) : false,
    pathChangesFocalLength: extras?.path ? pathChangesFocalLength(extras.path) : false,
  }
  if (backend === 'blender') {
    payload.providerBinding = 'blender'
    payload.compiledProviderPayload = { keys: extras?.path?.points ?? [], adapter: 'descriptor-only' }
  }
  if (backend === 'three.js' || backend === 'hvs-3d') {
    payload.providerBinding = backend
  }
  return {
    backend,
    honesty: meta.honesty,
    capabilities: meta.capabilities,
    payload,
  }
}
