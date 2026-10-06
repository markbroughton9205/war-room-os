import { fromSeconds, toSeconds } from '../time'
import { evaluateScene, hashScene, samplePath } from '../director3d/evaluate'
import type { Hvs3DScene } from '../director3d/types'
import type { HvsDirectorPlan, HvsDirectorPrevis, HvsDirectorStoryboardFrame, HvsTrackSample } from './types'
import { did } from './types'
import { DIRECTOR_NODE } from './compile'

function projectXZ(p: { x: number; z: number }): { x: number; y: number } {
  return { x: 160 + p.x * 9, y: 110 + p.z * 6 }
}

export function storyboardSvg(label: string, positions: Record<string, { x: number; z: number }>, camera: { x: number; z: number } | null): string {
  const dots = Object.entries(positions).map(([name, p]) => {
    const s = projectXZ(p)
    const fill = name === 'rael' || name === 'person'
      ? '#c9a227'
      : name === 'car'
        ? '#111111'
        : name === 'building'
          ? '#4a6288'
          : name.startsWith('bg')
            ? '#8a7a62'
            : '#c48a4a'
    return `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${name.startsWith('bg') ? 3 : 5}" fill="${fill}"/><text x="${(s.x + 7).toFixed(1)}" y="${(s.y - 6).toFixed(1)}" fill="#efe6d2" font-size="9">${name}</text>`
  }).join('')
  const cam = camera ? projectXZ(camera) : null
  const camMark = cam ? `<rect x="${cam.x - 4}" y="${cam.y - 4}" width="8" height="8" fill="#5ce1ff"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0b121d"/><text x="10" y="16" fill="#e8c872" font-size="11">${label}</text><text x="10" y="172" fill="#7f8b99" font-size="9">3D CAMERA STILL · WIREFRAME · NOT GENERATED ART</text>${dots}${camMark}</svg>`
}

function sampleTrack(path: { points: Array<{ time: { ticks: number; timescale: number }; position: { x: number; y: number; z: number } }> } | undefined, durationSec: number, timescale: number, steps = 10): HvsTrackSample[] {
  const samples: HvsTrackSample[] = []
  if (!path) return samples
  for (let i = 0; i <= steps; i++) {
    const t = (durationSec * i) / steps
    const p = samplePath(path as Parameters<typeof samplePath>[0], fromSeconds(t, timescale))
    if (p) samples.push({ t, ...p })
  }
  return samples
}

export function compileDirectorPlanToPrevis(plan: HvsDirectorPlan, scene: Hvs3DScene): HvsDirectorPrevis {
  const duration = scene.duration
  const shots = scene.shots.map(shot => ({
    id: shot.id,
    name: shot.name,
    startSec: toSeconds(shot.start),
    endSec: toSeconds(shot.end),
    purpose: plan.shots.find(item => item.id === shot.id)?.purpose ?? 'TRACK_ACTION',
  }))

  const cameraTracks = scene.shots.map(shot => {
    const cam = scene.cameras.find(item => item.id === shot.cameraId)
    const samples: HvsTrackSample[] = []
    const start = toSeconds(shot.start)
    const end = toSeconds(shot.end)
    for (let i = 0; i < 6; i++) {
      const t = start + ((end - start) * i) / 5
      const evald = evaluateScene(scene, fromSeconds(t, duration.timescale))
      const node = cam ? evald.nodes[cam.nodeId] : null
      if (node) samples.push({ t, ...node.transform.position })
    }
    return { shotId: shot.id, samples }
  })

  const subjectPath = scene.paths.find(item => item.id === DIRECTOR_NODE.pathPerson)
  const actorTracks = [{ ref: DIRECTOR_NODE.person, samples: sampleTrack(subjectPath, toSeconds(duration), duration.timescale) }]
  const crowdTracks = plan.backgroundPopulation.actors.map(extra => {
    const path = scene.paths.find(item => item.assignedNodeId === extra.ref)
    return { ref: extra.ref, samples: sampleTrack(path, toSeconds(duration), duration.timescale, 8) }
  })

  const storyboard: HvsDirectorStoryboardFrame[] = scene.shots.map((shot, index) => {
    const mid = (toSeconds(shot.start) + toSeconds(shot.end)) / 2
    const evald = evaluateScene(scene, fromSeconds(mid, duration.timescale))
    const rael = evald.nodes[DIRECTOR_NODE.person]?.transform.position
    const car = evald.nodes[DIRECTOR_NODE.car]?.transform.position
    const building = evald.nodes[DIRECTOR_NODE.building]?.transform.position
    const doorway = evald.nodes[DIRECTOR_NODE.doorway]?.transform.position
    const cam = scene.cameras.find(item => item.id === evald.activeCameraId)
    const camPos = cam ? evald.nodes[cam.nodeId]?.transform.position : null
    const positions: Record<string, { x: number; z: number }> = {}
    if (rael) positions.rael = rael
    if (car) positions.car = car
    if (building) positions.building = building
    if (doorway) positions.doorway = doorway
    for (const extra of plan.backgroundPopulation.actors.slice(0, 6)) {
      const pos = evald.nodes[extra.ref]?.transform.position
      if (pos) positions[extra.id] = pos
    }
    const directorShot = plan.shots.find(item => item.id === shot.id)
    const derivedAssetId = `asset-sb-${shot.id}`
    return {
      id: `sb-${shot.id}`,
      shotId: shot.id,
      index,
      title: shot.name,
      description: directorShot ? `${directorShot.purpose} · ${directorShot.directorReason}` : shot.notes,
      derivedFrom: '3D_CAMERA_EVAL',
      svg: storyboardSvg(shot.name, positions, camPos),
      time: fromSeconds(mid, duration.timescale),
      derivedAssetId,
    }
  })

  return {
    id: did('previs'),
    planId: plan.id,
    sceneId: scene.id,
    duration,
    shots,
    sceneHash: hashScene(scene),
    cameraTracks,
    subjectTracks: actorTracks,
    actorTracks,
    crowdTracks,
    destructionRefs: plan.destructionPlanRefs,
    lightingState: plan.lightingPlan.summary,
    artifactRefs: storyboard.map(item => item.derivedAssetId ?? item.id),
    storyboard,
    status: 'ready',
    playback: 'realtime-viewport',
  }
}
