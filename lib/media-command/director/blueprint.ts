import type { Hvs3DScene } from '../director3d/types'
import { attachCameraBridge } from '../director3d/camera-bridge'
import type { HvsDirectorPlan, HvsDirectorPrevis, HvsProductionBlueprint } from './types'
import { did } from './types'

export function compileProductionBlueprint(
  plan: HvsDirectorPlan,
  scene: Hvs3DScene,
  previs: HvsDirectorPrevis,
): HvsProductionBlueprint {
  const specs = attachCameraBridge(scene).specs
  return {
    id: did('pbp'),
    planId: plan.id,
    sceneId: scene.id,
    projectId: plan.projectId,
    providerNeutral: true,
    generatorAuthorized: false,
    duration: plan.duration,
    storyBeats: plan.storyBeats,
    shots: plan.shots,
    cameraSpecs: specs,
    cameraTrajectories: previs.cameraTracks,
    subjectTrajectories: previs.subjectTracks,
    actorTrajectories: previs.actorTracks,
    crowdBehavior: plan.backgroundPopulation,
    characterRefs: plan.castRefs,
    sceneState: plan.continuityState,
    elementRefs: plan.elements,
    lighting: plan.lightingPlan,
    focus: plan.focusPlan,
    destructionTiming: {
      startSec: plan.timing.collapseSec,
      impactSec: plan.timing.impactSec,
      endSec: plan.timing.durationSec,
    },
    vfxCues: plan.vfxCues,
    continuity: plan.continuityState,
    storyboardFrameRefs: previs.storyboard.map(item => item.derivedAssetId ?? item.id),
    createdAt: new Date().toISOString(),
  }
}

export function requestDirectorVideoGeneration(): never {
  throw new Error('VIDEO GENERATION NOT AUTHORIZED')
}
