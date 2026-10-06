import { cuesFromEvents } from './cues'
import { releaseTimeForPiece } from './guides'
import type { PlaybackNode } from './playback'
import type {
  HvsAudioCue,
  HvsCameraFxCue,
  HvsCinematicStrength,
  HvsDestructionEvent,
  HvsDestructionPlan,
  HvsMaterialId,
  HvsStructuralGraph,
  HvsVolumeCue,
  Vec3,
} from './types'
import { HVS_PREVIS_SOLVER_ID, HVS_PREVIS_SOLVER_VERSION } from './types'

type Body = {
  id: string
  role: 'PRIMARY_CHUNKS' | 'SECONDARY_DEBRIS'
  supportClass: PlaybackNode['supportClass']
  materialId: HvsMaterialId
  w: number
  h: number
  d: number
  px: number
  py: number
  pz: number
  restX: number
  restY: number
  restZ: number
  vx: number
  vy: number
  vz: number
  tilt: number
  tiltVel: number
  column: number
  row: number | null
  dynamic: boolean
  releaseAt: number | null
  released: boolean
  grounded: boolean
  impacted: boolean
  frames: PlaybackNode['frames']
}

export type PrevisSolveResult = {
  backend: typeof HVS_PREVIS_SOLVER_ID
  backendVersion: typeof HVS_PREVIS_SOLVER_VERSION
  fps: number
  frameCount: number
  durationSec: number
  nodes: PlaybackNode[]
  events: HvsDestructionEvent[]
  audioCues: HvsAudioCue[]
  volumeCues: HvsVolumeCue[]
  cameraCues: HvsCameraFxCue[]
}

const IMPULSE: Record<HvsCinematicStrength, number> = { GENTLE: 0.35, MODERATE: 0.85, STRONG: 1.45 }

function velocityClass(speed: number): 'SLOW' | 'MODERATE' | 'FAST' {
  if (speed < 1.5) return 'SLOW'
  if (speed < 6) return 'MODERATE'
  return 'FAST'
}

function norm(v: Vec3): Vec3 {
  const m = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / m, y: v.y / m, z: v.z / m }
}

export function solvePrevis(graph: HvsStructuralGraph, plan: HvsDestructionPlan): PrevisSolveResult {
  if (plan.simulationConfig.backend !== HVS_PREVIS_SOLVER_ID) {
    throw new Error('Physics backend is not HVS_PREVIS_SOLVER.')
  }
  const events: HvsDestructionEvent[] = []
  let eventSerial = 0
  const pushEvent = (event: Omit<HvsDestructionEvent, 'id'>): void => {
    if (events.length >= 420) return
    events.push({ ...event, id: `evt-${eventSerial++}` })
  }
  const bodies: Body[] = graph.nodes.map(node => {
    const releaseAt = releaseTimeForPiece({
      column: node.column,
      row: node.row,
      rows: 6,
      columnCount: 10,
      mode: plan.simulationConfig.mode,
      guides: plan.guidePlan.primitives,
      durationSec: plan.simulationConfig.durationSec,
    })
    return {
      id: node.id,
      role: 'PRIMARY_CHUNKS',
      supportClass: node.supportClass,
      materialId: node.materialId,
      w: node.transform.size.x,
      h: node.transform.size.y,
      d: node.transform.size.z,
      px: node.transform.position.x,
      py: node.transform.position.y,
      pz: node.transform.position.z,
      restX: node.transform.position.x,
      restY: node.transform.position.y,
      restZ: node.transform.position.z,
      vx: 0,
      vy: 0,
      vz: 0,
      tilt: 0,
      tiltVel: 0,
      column: node.column,
      row: node.row,
      dynamic: false,
      releaseAt,
      released: false,
      grounded: false,
      impacted: false,
      frames: [],
    }
  })
  const brokenEdges = new Set<string>()
  const direction = norm(plan.forcePlan.direction)
  const impulse = IMPULSE[plan.forcePlan.impulseClass]
  const fps = plan.simulationConfig.fps
  const stepsPerFrame = plan.simulationConfig.substeps
  const dt = 1 / (fps * stepsPerFrame)
  const frameCount = Math.round(plan.simulationConfig.durationSec * fps) + 1
  let time = 0
  let groundImpacts = 0
  let collapsed = false
  let secondary = 0
  pushEvent({
    type: 'SIM_START',
    time: 0,
    position: { x: 0, y: 1.5, z: 0 },
    materialId: plan.materialAssignments[0]?.materialId ?? 'CONCRETE',
    nodeId: null,
    edgeId: null,
    impulseClass: plan.forcePlan.impulseClass,
    velocityClass: null,
  })

  const snapshot = (): void => {
    for (const body of bodies) {
      body.frames.push({ x: body.px, y: body.py, z: body.pz, tilt: body.tilt })
    }
  }

  const releaseBody = (body: Body): void => {
    if (body.released || body.releaseAt == null) return
    body.released = true
    body.dynamic = true
    const left = body.column <= 1
    const scale = left ? 1 : 0.45
    body.vx += direction.x * impulse * scale
    body.vy += Math.max(-0.2, direction.y) * impulse * 0.15
    body.vz += direction.z * impulse * scale
    body.tiltVel += (left ? -0.7 : -0.25) * (body.column % 2 === 0 ? 1 : -1)
    pushEvent({
      type: 'CHUNK_RELEASE',
      time,
      position: { x: body.px, y: body.py, z: body.pz },
      materialId: body.materialId,
      nodeId: body.id,
      edgeId: null,
      impulseClass: plan.forcePlan.impulseClass,
      velocityClass: velocityClass(Math.hypot(body.vx, body.vy, body.vz)),
    })
    for (const edge of graph.edges) {
      if (brokenEdges.has(edge.id)) continue
      if (edge.a !== body.id && edge.b !== body.id) continue
      brokenEdges.add(edge.id)
      pushEvent({
        type: 'CONSTRAINT_BREAK',
        time,
        position: { x: body.px, y: body.py, z: body.pz },
        materialId: edge.materialId,
        nodeId: body.id,
        edgeId: edge.id,
        impulseClass: plan.forcePlan.impulseClass,
        velocityClass: null,
      })
    }
  }

  const spawnDebris = (body: Body): void => {
    if (secondary >= plan.debrisPlan.secondaryBudget) return
    secondary += 1
    const past = bodies[0]?.frames.length ?? 0
    const frames = Array.from({ length: past }, () => ({ x: body.px, y: -2, z: body.pz + 0.2, tilt: 0 }))
    bodies.push({
      id: `debris-${secondary}`,
      role: 'SECONDARY_DEBRIS',
      supportClass: 'NONE',
      materialId: body.materialId,
      w: 0.08,
      h: 0.06,
      d: 0.07,
      px: body.px,
      py: body.h * 0.5 + 0.05,
      pz: body.pz + 0.16,
      restX: body.px,
      restY: body.h * 0.5 + 0.05,
      restZ: body.pz + 0.16,
      vx: body.vx * 0.4 + (body.column % 2 === 0 ? 0.4 : -0.3),
      vy: 1.4,
      vz: 0.55,
      tilt: 0,
      tiltVel: 1.2,
      column: body.column,
      row: body.row,
      dynamic: true,
      releaseAt: time,
      released: true,
      grounded: false,
      impacted: false,
      frames,
    })
  }

  snapshot()
  for (let frame = 1; frame < frameCount; frame += 1) {
    for (let step = 0; step < stepsPerFrame; step += 1) {
      time += dt
      for (const body of bodies) {
        if (!body.released && body.releaseAt != null && time >= body.releaseAt) releaseBody(body)
        if (!body.dynamic) {
          body.px = body.restX
          body.py = body.restY
          body.pz = body.restZ
          body.vx = 0
          body.vy = 0
          body.vz = 0
          body.tilt = 0
          body.tiltVel = 0
          continue
        }
        body.vy -= plan.simulationConfig.gravity * dt
        body.px += body.vx * dt
        body.py += body.vy * dt
        body.pz += body.vz * dt
        body.tilt += body.tiltVel * dt
        const speed = Math.hypot(body.vx, body.vy, body.vz)
        if (speed > 18) {
          const scale = 18 / speed
          body.vx *= scale
          body.vy *= scale
          body.vz *= scale
        }
        const bottom = body.py - body.h / 2
        if (bottom < 0) {
          body.py = body.h / 2
          if (body.vy < -0.2 && !body.grounded) {
            body.grounded = true
            groundImpacts += 1
            pushEvent({
              type: 'GROUND_IMPACT',
              time,
              position: { x: body.px, y: 0, z: body.pz },
              materialId: body.materialId,
              nodeId: body.id,
              edgeId: null,
              impulseClass: plan.forcePlan.impulseClass,
              velocityClass: velocityClass(Math.abs(body.vy)),
            })
            if (body.role === 'PRIMARY_CHUNKS') spawnDebris(body)
            if (!collapsed && groundImpacts >= 10) {
              collapsed = true
              pushEvent({
                type: 'MAJOR_COLLAPSE',
                time,
                position: { x: body.px, y: 0.4, z: body.pz },
                materialId: body.materialId,
                nodeId: body.id,
                edgeId: null,
                impulseClass: plan.forcePlan.impulseClass,
                velocityClass: 'FAST',
              })
            }
          }
          if (body.vy < 0) body.vy = -body.vy * 0.12
          body.vx *= 0.62
          body.vz *= 0.62
          body.tiltVel *= 0.5
          if (Math.hypot(body.vx, body.vy, body.vz) < plan.simulationConfig.sleepSpeed) {
            body.vx = 0
            body.vy = 0
            body.vz = 0
            body.tiltVel = 0
          }
        }
      }
      resolveContacts(bodies, time, pushEvent)
    }
    snapshot()
  }
  pushEvent({
    type: 'SIM_END',
    time,
    position: { x: 0, y: 0.2, z: 0 },
    materialId: plan.materialAssignments[0]?.materialId ?? null,
    nodeId: null,
    edgeId: null,
    impulseClass: null,
    velocityClass: null,
  })
  const cues = cuesFromEvents(events, plan.secondaryFxPlan.dustClass, plan.cameraFxPlan.shakeClass)
  return {
    backend: HVS_PREVIS_SOLVER_ID,
    backendVersion: HVS_PREVIS_SOLVER_VERSION,
    fps,
    frameCount,
    durationSec: plan.simulationConfig.durationSec,
    nodes: bodies.map(body => ({
      id: body.id,
      role: body.role,
      supportClass: body.supportClass,
      size: { x: body.w, y: body.h, z: body.d },
      frames: body.frames,
    })),
    events,
    audioCues: cues.audio,
    volumeCues: cues.volume,
    cameraCues: cues.camera,
  }
}

function resolveContacts(
  bodies: Body[],
  time: number,
  pushEvent: (event: Omit<HvsDestructionEvent, 'id'>) => void,
): void {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i]
      const b = bodies[j]
      if (!a.dynamic && !b.dynamic) continue
      const overlapX = (a.w + b.w) / 2 - Math.abs(b.px - a.px)
      const overlapY = (a.h + b.h) / 2 - Math.abs(b.py - a.py)
      const overlapZ = (a.d + b.d) / 2 - Math.abs(b.pz - a.pz)
      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue
      const axis = overlapX < overlapY && overlapX < overlapZ ? 'x' : overlapY < overlapZ ? 'y' : 'z'
      const sign = axis === 'x'
        ? Math.sign(b.px - a.px) || 1
        : axis === 'y'
          ? Math.sign(b.py - a.py) || 1
          : Math.sign(b.pz - a.pz) || 1
      const overlap = axis === 'x' ? overlapX : axis === 'y' ? overlapY : overlapZ
      if (a.dynamic && b.dynamic) {
        const half = overlap / 2
        if (axis === 'x') { a.px -= sign * half; b.px += sign * half; a.vx *= 0.8; b.vx *= 0.8 }
        else if (axis === 'y') { a.py -= sign * half; b.py += sign * half; a.vy *= 0.8; b.vy *= 0.8 }
        else { a.pz -= sign * half; b.pz += sign * half; a.vz *= 0.8; b.vz *= 0.8 }
      } else if (a.dynamic) {
        if (axis === 'x') { a.px -= sign * overlap; a.vx *= -0.2 }
        else if (axis === 'y') { a.py -= sign * overlap; a.vy *= -0.15 }
        else { a.pz -= sign * overlap; a.vz *= -0.2 }
        if (!a.impacted && Math.hypot(a.vx, a.vy, a.vz) > 0.8) {
          a.impacted = true
          pushEvent({
            type: 'CHUNK_IMPACT',
            time,
            position: { x: a.px, y: a.py, z: a.pz },
            materialId: a.materialId,
            nodeId: a.id,
            edgeId: null,
            impulseClass: 'MODERATE',
            velocityClass: velocityClass(Math.hypot(a.vx, a.vy, a.vz)),
          })
        }
      } else {
        if (axis === 'x') { b.px += sign * overlap; b.vx *= -0.2 }
        else if (axis === 'y') { b.py += sign * overlap; b.vy *= -0.15 }
        else { b.pz += sign * overlap; b.vz *= -0.2 }
        if (!b.impacted && Math.hypot(b.vx, b.vy, b.vz) > 0.8) {
          b.impacted = true
          pushEvent({
            type: 'CHUNK_IMPACT',
            time,
            position: { x: b.px, y: b.py, z: b.pz },
            materialId: b.materialId,
            nodeId: b.id,
            edgeId: null,
            impulseClass: 'MODERATE',
            velocityClass: velocityClass(Math.hypot(b.vx, b.vy, b.vz)),
          })
        }
      }
    }
  }
}

export const hvsPrevisSolverBackend = {
  id: HVS_PREVIS_SOLVER_ID,
  isAvailable: () => true,
  describe: () => ({
    id: HVS_PREVIS_SOLVER_ID,
    status: 'AVAILABLE' as const,
    version: HVS_PREVIS_SOLVER_VERSION,
    integrationMode: 'NATIVE',
    claims: 'Deterministic small-tier previs. Not Bullet, Jolt, PhysX, or Blast.',
  }),
  simulate: solvePrevis,
}
