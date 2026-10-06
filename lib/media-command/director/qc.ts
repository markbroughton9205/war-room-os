import { toSeconds } from '../time'
import { evaluateScene } from '../director3d/evaluate'
import type { Hvs3DScene } from '../director3d/types'
import { fromSeconds } from '../time'
import type { HvsDirectorPlan, HvsDirectorQcIssue, HvsDirectorQcReport } from './types'
import { DIRECTOR_NODE } from './compile'
import { destructionStateAt } from './clock'

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function aabbHit(point: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }, half: { x: number; y: number; z: number }): boolean {
  return Math.abs(point.x - center.x) < half.x && Math.abs(point.y - center.y) < half.y && Math.abs(point.z - center.z) < half.z
}

export function runDirectorQc(plan: HvsDirectorPlan, scene: Hvs3DScene): HvsDirectorQcReport {
  const issues: HvsDirectorQcIssue[] = []
  const shots = [...plan.shots].sort((a, b) => a.order - b.order)
  for (const shot of shots) {
    const dur = toSeconds(shot.end) - toSeconds(shot.start)
    if (dur < 0.4) {
      issues.push({ code: 'SHOT_TOO_SHORT', severity: 'error', shotId: shot.id, message: `${shot.name} is shorter than 0.4s.` })
    }
  }
  for (let i = 0; i < shots.length - 1; i++) {
    const aEnd = toSeconds(shots[i].end)
    const bStart = toSeconds(shots[i + 1].start)
    if (Math.abs(aEnd - bStart) > 0.05 && aEnd > bStart) {
      issues.push({ code: 'SHOT_OVERLAP', severity: 'error', shotId: shots[i + 1].id, message: `${shots[i].name} overlaps ${shots[i + 1].name}.` })
    }
  }

  if (plan.timing.collapseSec + 0.05 < plan.timing.walkArriveSec && plan.constraints.some(item => item === 'BUILDING_INTACT_UNTIL_BEAT' || /intact until/i.test(item))) {
    issues.push({
      code: 'DESTRUCTION_TOO_EARLY',
      severity: 'warning',
      shotId: 'shot-4',
      message: "Collapse begins before Ra'el reaches the doorway.",
    })
  }

  const cars = scene.props.filter(item => item.kind === 'car')
  if (cars.length !== 1) {
    issues.push({ code: 'OBJECT_CONTINUITY', severity: 'error', shotId: null, message: `Expected one black car, found ${cars.length}.` })
  }
  const heroes = scene.characters.filter(item => item.role === 'HERO' || item.id === DIRECTOR_NODE.char || item.identityRef === DIRECTOR_NODE.char)
  if (heroes.length !== 1) {
    issues.push({ code: 'RAEL_DUPLICATION', severity: 'error', shotId: null, message: `Expected one Ra'el identity, found ${heroes.length}.` })
  }
  if (scene.characters.length !== 1) {
    issues.push({ code: 'OBJECT_CONTINUITY', severity: 'error', shotId: null, message: 'Hero identity split across shots.' })
  }

  const extras = scene.props.filter(item => item.kind === 'extra')
  if (extras.length < 12) {
    issues.push({ code: 'OBJECT_CONTINUITY', severity: 'error', shotId: null, message: `Expected 12 background extras, found ${extras.length}.` })
  }

  const sampleAt = [0.2, plan.timing.orbitStartSec + 0.2, plan.timing.collapseSec + 0.2, plan.timing.closeupStartSec + 0.2]
  for (const sec of sampleAt) {
    if (sec < 0 || sec > plan.timing.durationSec) continue
    const evald = evaluateScene(scene, fromSeconds(sec, scene.duration.timescale))
    const cam = scene.cameras.find(item => item.id === evald.activeCameraId)
    const camNode = cam ? evald.nodes[cam.nodeId] : null
    const car = evald.nodes[DIRECTOR_NODE.car]
    const building = evald.nodes[DIRECTOR_NODE.building]
    const person = evald.nodes[DIRECTOR_NODE.person]
    if (camNode && car && aabbHit(camNode.transform.position, car.transform.position, { x: 0.7, y: 0.45, z: 1.8 })) {
      issues.push({ code: 'CAMERA_INSIDE_OBJECT', severity: 'error', shotId: evald.activeShotId, message: 'Camera inside car bounding box.' })
    }
    if (camNode && building && aabbHit(camNode.transform.position, building.transform.position, { x: 3.2, y: 3.2, z: 0.9 })) {
      issues.push({ code: 'CAMERA_CLIPS_GEOMETRY', severity: 'warning', shotId: evald.activeShotId, message: 'Camera near-plane inside building bounds.' })
    }
    if (camNode && person && camNode.lookAt) {
      const toPerson = dist(camNode.transform.position, person.transform.position)
      if (toPerson < 0.35) {
        issues.push({ code: 'CAMERA_CLIPS_GEOMETRY', severity: 'warning', shotId: evald.activeShotId, message: "Camera too close to Ra'el." })
      }
      const forward = {
        x: camNode.lookAt.x - camNode.transform.position.x,
        y: 0,
        z: camNode.lookAt.z - camNode.transform.position.z,
      }
      const toSub = {
        x: person.transform.position.x - camNode.transform.position.x,
        y: 0,
        z: person.transform.position.z - camNode.transform.position.z,
      }
      const mag = Math.hypot(forward.x, forward.z) * Math.hypot(toSub.x, toSub.z)
      const cos = mag > 1e-6 ? (forward.x * toSub.x + forward.z * toSub.z) / mag : 1
      if (cos < 0.15) {
        issues.push({ code: 'TARGET_LOST', severity: 'warning', shotId: evald.activeShotId, message: "Ra'el is not in front of the camera." })
        issues.push({ code: 'FRAMING_WARNING', severity: 'warning', shotId: evald.activeShotId, message: 'Hero target may leave frame.' })
      }
    }
    if (cam && person && cam.target?.kind === 'CHARACTER') {
      const orbiting = cam.movement === 'ORBIT'
      if (orbiting) {
        const target = scene.characters[0]
        const targetNode = target ? evald.nodes[target.nodeId] : null
        if (targetNode && Math.abs(targetNode.transform.position.z - person.transform.position.z) > 1.5) {
          issues.push({ code: 'ACTOR_CAMERA_DESYNC', severity: 'warning', shotId: evald.activeShotId, message: "Orbit is not following Ra'el's walk." })
        }
      }
    }
    const expected = destructionStateAt(plan.timing.collapseSec, plan.timing.impactSec, plan.timing.durationSec, sec)
    if (sec < plan.timing.collapseSec && expected !== 'INTACT') {
      issues.push({ code: 'BUILDING_STATE_MISMATCH', severity: 'error', shotId: evald.activeShotId, message: 'Building state is not intact before the collapse beat.' })
    }
  }

  const beforeCollapse = evaluateScene(scene, fromSeconds(Math.max(0, plan.timing.collapseSec - 0.05), scene.duration.timescale))
  const afterFlee = evaluateScene(scene, fromSeconds(Math.min(plan.timing.durationSec, plan.timing.crowdFleeSec + 0.8), scene.duration.timescale))
  for (const extra of plan.backgroundPopulation.actors.filter(item => item.nearestToEvent)) {
    const before = beforeCollapse.nodes[extra.ref]?.transform.position
    if (before && Math.abs(before.x - extra.start.x) > 0.8) {
      issues.push({ code: 'CROWD_REACT_BEFORE_EVENT', severity: 'error', shotId: 'shot-4', message: `${extra.id} flees before the collapse cue.` })
    }
    const after = afterFlee.nodes[extra.ref]?.transform.position
    if (after && before && dist(after, before) < 0.4) {
      issues.push({ code: 'OBJECT_CONTINUITY', severity: 'warning', shotId: 'shot-4', message: `${extra.id} did not move away after the collapse.` })
    }
  }

  const axis = plan.continuityState.axisOfAction
  if (!axis.includes('-Z')) {
    issues.push({ code: 'CONTINUITY_AXIS', severity: 'info', shotId: null, message: 'Axis of action is unclear.' })
  }

  return { ok: !issues.some(item => item.severity === 'error'), issues }
}
