import { fromSeconds, toSeconds } from '../time'
import { evaluateScene } from './evaluate'
import { nid, type Hvs3DPrevisResult, type Hvs3DScene, type HvsProductionBlueprint3D } from './types'
import { hashScene } from './evaluate'

export function compile3DProductionBlueprint(scene: Hvs3DScene): HvsProductionBlueprint3D {
  const samples = 9
  const shots = scene.shots.map(shot => {
    const start = toSeconds(shot.start)
    const end = toSeconds(shot.end)
    const camera = scene.cameras.find(item => item.id === shot.cameraId)
    const cameraTrack = []
    for (let i = 0; i < samples; i++) {
      const t = start + ((end - start) * i) / (samples - 1)
      const time = fromSeconds(t, scene.duration.timescale)
      const evald = evaluateScene(scene, time)
      const camNode = camera ? evald.nodes[camera.nodeId] : null
      if (!camNode) continue
      cameraTrack.push({
        time,
        position: camNode.transform.position,
        lookAt: camNode.lookAt ?? { x: 0, y: 1, z: 0 },
      })
    }
    const subjectTracks = scene.characters.map(character => {
      const points = []
      for (let i = 0; i < samples; i++) {
        const t = start + ((end - start) * i) / (samples - 1)
        const time = fromSeconds(t, scene.duration.timescale)
        const evald = evaluateScene(scene, time)
        points.push({ time, position: evald.nodes[character.nodeId]?.transform.position ?? character.transform.position })
      }
      return { nodeId: character.nodeId, label: character.label, samples: points }
    })
    return {
      id: shot.id,
      name: shot.name,
      start: shot.start,
      end: shot.end,
      cameraId: shot.cameraId,
      motionPreset: shot.motionPreset,
      framing: camera?.virtualCameraMode ?? 'CINEMATIC_FOLLOW',
      cameraTrack,
      subjectTracks,
    }
  })

  return {
    id: nid('bp3d'),
    sceneId: scene.id,
    projectId: scene.projectId,
    providerNeutral: true,
    duration: scene.duration,
    frameRate: scene.frameRate,
    environment: scene.environment,
    lightingIntent: scene.environment.timeOfDay === 'night' ? 'night-cinematic' : 'natural-day',
    shots,
    objectPlacement: scene.objects
      .filter(item => item.type !== 'GROUP')
      .map(item => ({
        id: item.id,
        label: item.label,
        type: item.type,
        position: item.transform.position,
        placeholder: item.placeholder,
      })),
    referenceRequirements: ['previs-mp4', 'camera-trajectory', 'first-last-frame'],
    createdAt: new Date().toISOString(),
  }
}

export function request3DVideoGeneration(): never {
  throw new Error('VIDEO GENERATION NOT AUTHORIZED')
}

export function buildPrevisResult(scene: Hvs3DScene): Hvs3DPrevisResult {
  return {
    sceneId: scene.id,
    duration: scene.duration,
    frameRate: scene.frameRate,
    shots: scene.shots.map(item => ({
      id: item.id,
      name: item.name,
      startSec: toSeconds(item.start),
      endSec: toSeconds(item.end),
    })),
    cameraData: scene.cameras.map(item => ({
      id: item.id,
      name: item.name,
      movement: item.movement,
      target: item.target,
    })),
    sceneHash: hashScene(scene),
    previewVideoPath: null,
    playback: 'realtime-viewport',
  }
}
