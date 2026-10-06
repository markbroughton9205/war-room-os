import type { Hvs3DCamera, Hvs3DScene, HvsMotionPath3D } from '../director3d/types'
import { camera3DToSpec } from '../director3d/camera-bridge'
import type { HvsCinemaPlan, HvsShot, HvsStoryboardShotLink } from './types'
import type { StoryboardFrame } from '../types'

export function storyboardLinksForPlan(plan: HvsCinemaPlan, frames: StoryboardFrame[]): HvsStoryboardShotLink[] {
  return plan.shots.map((shot, index) => ({
    shotId: shot.id,
    frameId: frames[index]?.id ?? null,
    beatId: frames[index]?.id ?? null,
  }))
}

export function cinemaShotTo3DCamera(scene: Hvs3DScene, shot: HvsShot): Hvs3DCamera | null {
  return scene.cameras.find(item => item.cameraSpecId === shot.cameraSpec.id) ?? scene.cameras.find(item => item.id === `ccam-${shot.id}`) ?? null
}

export function cinemaPathTo3D(scene: Hvs3DScene, shot: HvsShot): HvsMotionPath3D | null {
  return scene.paths.find(item => item.id === `c3dpath-${shot.id}`) ?? null
}

export function destructionShakeForEvent(eventKind: string): { intensity: number; frequency: number; durationSec: number } {
  if (eventKind === 'MAJOR_COLLAPSE') return { intensity: 0.22, frequency: 9, durationSec: 1.8 }
  if (eventKind === 'DUST_PLUME') return { intensity: 0.06, frequency: 4, durationSec: 2.4 }
  return { intensity: 0.1, frequency: 8, durationSec: 1 }
}

export function specsFromCompiledScene(scene: Hvs3DScene) {
  return scene.cameras.map(camera3DToSpec)
}
