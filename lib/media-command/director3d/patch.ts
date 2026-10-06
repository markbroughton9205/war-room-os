import { nid, type Hvs3DPlanPatch, type Hvs3DPlanPatchKind, type Hvs3DScene } from './types'
import { apply3DOps, type Hvs3DOp } from './ops'
import { fromSeconds, toSeconds } from '../time'
import { vec3 } from './types'

export function parse3DPlanPatch(scene: Hvs3DScene, prompt: string): Hvs3DPlanPatch {
  const lower = prompt.toLowerCase()
  const kinds: Hvs3DPlanPatchKind[] = []
  const summaryLines: string[] = []
  if (/\bcamera.{0,20}(low|lower)\b|\blower\b/.test(lower)) {
    kinds.push('CHANGE_CAMERA_PATH', 'CHANGE_CAMERA_START')
    summaryLines.push('Lower the camera path.')
  }
  if (/\bslow\b|\bslower\b/.test(lower) && /\borbit\b/.test(lower)) {
    kinds.push('CHANGE_SPEED', 'CHANGE_CAMERA_PATH')
    summaryLines.push('Slow the orbit.')
  }
  if (/\bcloser to the car\b|\bcloser to (it|the vehicle)\b/.test(lower)) {
    kinds.push('MOVE_SUBJECT')
    summaryLines.push('Move the character closer to the car.')
  }
  if (/\bbehind the car\b/.test(lower)) {
    kinds.push('MOVE_SUBJECT')
    summaryLines.push('Place the character behind the car.')
  }
  if (/\bdaytime|make it day|change this to daytime\b/.test(lower)) {
    kinds.push('CHANGE_ENVIRONMENT', 'CHANGE_LIGHTING')
    summaryLines.push('Change the scene to daytime.')
  }
  if (/\bclose-up first|put the close-up first|closeup first\b/.test(lower)) {
    kinds.push('REORDER_SHOTS')
    summaryLines.push('Put the close-up first.')
  }
  if (/\btighter|tighter close-up|final close-up tighter\b/.test(lower)) {
    kinds.push('CHANGE_FOCAL_LENGTH', 'CHANGE_FRAMING')
    summaryLines.push('Make the final close-up tighter.')
  }
  if (/\bfarther away\b/.test(lower)) {
    kinds.push('MOVE_SUBJECT')
    summaryLines.push('Move the character farther from the car.')
  }
  if (!kinds.length) {
    kinds.push('CHANGE_CAMERA_PATH')
    summaryLines.push('Adjust the directed scene from that note.')
  }
  return {
    id: nid('patch3d'),
    sceneId: scene.id,
    prompt,
    kinds,
    summaryLines,
    status: 'proposed',
    approvalRequired: true,
    createdAt: new Date().toISOString(),
  }
}

export function opsForPatch(scene: Hvs3DScene, patch: Hvs3DPlanPatch): Hvs3DOp[] {
  const ops: Hvs3DOp[] = []
  const cam = scene.cameras[0]
  const person = scene.characters[0]
  const camPath = cam ? scene.paths.find(item => item.id === cam.pathId) : null
  if (patch.kinds.includes('CHANGE_CAMERA_PATH') || patch.kinds.includes('CHANGE_CAMERA_START')) {
    if (camPath) {
      const lowered = {
        ...camPath,
        points: camPath.points.map(point => ({
          ...point,
          position: { ...point.position, y: Math.max(0.18, point.position.y - 0.28) },
        })),
      }
      if (/\bslow\b/.test(patch.prompt.toLowerCase()) && camPath.points.length >= 4) {
        const p = lowered.points
        if (p[2] && p[3]) {
          p[2] = { ...p[2], time: fromSeconds(Math.min(toSeconds(p[3].time) - 0.4, toSeconds(p[2].time) + 0.7)) }
        }
      }
      ops.push({ kind: 'EDIT_PATH', pathId: camPath.id, path: { points: lowered.points } })
    }
  }
  if (patch.kinds.includes('MOVE_SUBJECT') && person) {
    const lower = patch.prompt.toLowerCase()
    const car = scene.objects.find(item => item.placeholder === 'car')
    const carPos = car?.transform.position ?? vec3(0, 0, 0)
    const carDepth = car ? Math.abs(car.transform.scale.z) * 0.5 : 2.2
    const next = /\bbehind/.test(lower)
      ? vec3(carPos.x, 0, carPos.z + carDepth + 0.7)
      : /\bfarther/.test(lower)
        ? vec3(carPos.x + 2.8, 0, carPos.z + 0.6)
        : vec3(carPos.x + 1.05, 0, carPos.z + 0.2)
    ops.push({ kind: 'MOVE_CHARACTER', characterId: person.id, position: next })
  }
  if (patch.kinds.includes('CHANGE_ENVIRONMENT')) {
    ops.push({
      kind: 'SET_ENVIRONMENT',
      environment: { timeOfDay: 'day', sky: 'day', background: '#9ec9ef', ambientLight: 0.5, fog: 0.03 },
    })
  }
  if (patch.kinds.includes('CHANGE_FOCAL_LENGTH') && cam) {
    ops.push({ kind: 'SET_FOCAL_LENGTH', cameraId: cam.id, focalLength: 85 })
  }
  if (patch.kinds.includes('REORDER_SHOTS')) {
    const close = scene.shots.find(item => /close/i.test(item.name) || /close/i.test(item.commanderLabel))
    const rest = scene.shots.filter(item => item.id !== close?.id)
    if (close) ops.push({ kind: 'REORDER_SHOT', shotIds: [close.id, ...rest.map(item => item.id)] })
  }
  return ops
}

export function applyPatch(scene: Hvs3DScene, patch: Hvs3DPlanPatch): Hvs3DScene {
  return apply3DOps(scene, opsForPatch(scene, patch))
}
