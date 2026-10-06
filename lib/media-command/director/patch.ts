import { did, type HvsDirectorPlan, type HvsDirectorPlanPatch, type HvsDirectorPlanPatchKind, type HvsDirectorTiming } from './types'
import { buildDirectorPlan } from './plan'
import { solveShotFraming } from './framing'

function round(n: number, d = 2): number {
  return Math.round(n * 10 ** d) / 10 ** d
}

function lockCollapseDependents(timingDelta: Partial<HvsDirectorTiming>, collapse: number, durationSec: number, kinds: HvsDirectorPlanPatchKind[]): void {
  timingDelta.collapseSec = round(collapse, 2)
  timingDelta.orbitEndSec = round(collapse, 2)
  timingDelta.retreatSec = round(collapse + 0.1, 2)
  timingDelta.impactSec = round(collapse + 1.2, 2)
  timingDelta.dustSec = round(collapse + 1.4, 2)
  timingDelta.crowdReactSec = round(collapse + 0.2, 2)
  timingDelta.crowdFleeSec = round(collapse + 0.35, 2)
  timingDelta.lookBackSec = round(collapse + 0.15, 2)
  timingDelta.turnToCameraSec = round(collapse + 0.9, 2)
  timingDelta.closeupStartSec = round(Math.max(timingDelta.closeupStartSec ?? collapse + 2.4, collapse + 2.4), 2)
  if ((timingDelta.closeupStartSec ?? collapse + 2.4) + 2 > durationSec) {
    timingDelta.durationSec = round((timingDelta.closeupStartSec ?? collapse + 2.4) + 2, 2)
    kinds.push('CHANGE_TOTAL_DURATION')
  }
}

export function parseDirectorPlanPatch(plan: HvsDirectorPlan, prompt: string): HvsDirectorPlanPatch {
  const lower = prompt.toLowerCase()
  const kinds: HvsDirectorPlanPatchKind[] = []
  const timingDelta: Partial<HvsDirectorTiming> = {}
  const linked: string[] = []
  const notes: string[] = []
  let directorChoice: string | null = null
  const t = plan.timing

  if (/\borbit slower|slow(?:er)? (?:down )?the orbit\b/.test(lower)) {
    kinds.push('CHANGE_SHOT_DURATION', 'CHANGE_CAMERA')
    const extra = 1.4
    timingDelta.orbitEndSec = round(t.orbitEndSec + extra)
    notes.push('Slow the clockwise orbit.')
  }
  if (/\breach the doorway before|reach the door before|person reach|ra'?el reach/.test(lower)) {
    kinds.push('CHANGE_SUBJECT_PATH', 'CHANGE_DESTRUCTION_TIMING')
    notes.push("Ra'el arrives at the doorway before collapse.")
  }
  if (/\bra'?el move faster|move faster\b/.test(lower)) {
    kinds.push('CHANGE_SUBJECT_PATH')
    timingDelta.walkArriveSec = round(Math.max(t.orbitStartSec + 0.8, Math.min(t.walkArriveSec - 1.1, t.collapseSec - 0.5)), 2)
    notes.push("Ra'el reaches the doorway sooner. Same identity.")
  }
  const rightPieceLater = /right side/.test(lower) && /collapse|fall/.test(lower)
  if (!rightPieceLater && /\bcollapse(?: the building)? later|building later|one second later\b/.test(lower)) {
    kinds.push('CHANGE_DESTRUCTION_TIMING')
    notes.push('Collapse later.')
  }
  if (rightPieceLater) {
    kinds.push('CHANGE_DESTRUCTION_TIMING')
    notes.push('Right side releases one second later. This invalidates the destruction cache.')
  }
  if (/\bfinal close-up lower|camera lower|lower and tighter|tighter\b/.test(lower)) {
    kinds.push('CHANGE_FRAMING', 'CHANGE_CAMERA', 'CHANGE_LENS')
    timingDelta.closeupHeight = round(Math.min(t.closeupHeight, 0.98), 2)
    if (/\btighter\b/.test(lower)) {
      timingDelta.closeupDistance = round(Math.max(1.35, t.closeupDistance - 0.45), 2)
      timingDelta.closeupFocalMm = Math.min(100, Math.max(t.closeupFocalMm, 90))
    }
    directorChoice = "Lower the camera and tighten with a slightly longer lens rather than cropping Ra'el's face out of frame."
    notes.push("Lower, tighter close-up on Ra'el.")
  }
  if (/\bkeep more of the falling building|more of the falling|building visible in the close-up|falling building visible behind\b/.test(lower)) {
    kinds.push('CHANGE_LENS', 'CHANGE_FRAMING', 'CHANGE_FOCUS', 'CHANGE_CAMERA')
    const solved = solveShotFraming({ goal: 'KEEP_BACKGROUND', focalMm: t.closeupFocalMm, distance: t.closeupDistance, height: t.closeupHeight })
    timingDelta.closeupFocalMm = solved.focalMm
    timingDelta.closeupDistance = round(solved.distance, 2)
    directorChoice = solved.directorChoice
    notes.push("Show more collapsing building behind Ra'el without abandoning the close-up.")
  }
  if (/\blower the final camera\b/.test(lower)) {
    kinds.push('CHANGE_CAMERA', 'CHANGE_FRAMING')
    const solved = solveShotFraming({ goal: 'LOWER', focalMm: t.closeupFocalMm, distance: t.closeupDistance, height: t.closeupHeight })
    timingDelta.closeupHeight = solved.height
    notes.push(solved.directorChoice)
  }
  if (/\bwider final lens|slightly wider final\b/.test(lower)) {
    kinds.push('CHANGE_LENS')
    const solved = solveShotFraming({ goal: 'WIDER_LENS', focalMm: t.closeupFocalMm, distance: t.closeupDistance, height: t.closeupHeight })
    timingDelta.closeupFocalMm = solved.focalMm
    notes.push(solved.directorChoice)
  }
  if (/\blook back\b/.test(lower)) {
    kinds.push('CHANGE_ACTING', 'CHANGE_GAZE')
    timingDelta.lookBack = true
    notes.push("Ra'el looks back at the collapse before turning to camera. Identity is unchanged.")
  }
  if (/\bmore background|add more background\b/.test(lower)) {
    kinds.push('CHANGE_CROWD')
    timingDelta.crowdCount = Math.min(24, t.crowdCount + 4)
    notes.push(`Background population ${t.crowdCount} → ${timingDelta.crowdCount}.`)
  }
  if (/\bmove the car closer to the doorway\b/.test(lower)) {
    kinds.push('CHANGE_PROP_POSITION', 'CHANGE_SUBJECT_PATH')
    notes.push("Move the car toward the doorway. Ra'el start stays beside the same car.")
  }
  if (/\bkeep the camera lower\b/.test(lower) && !timingDelta.closeupHeight) {
    kinds.push('CHANGE_CAMERA')
    timingDelta.closeupHeight = round(Math.min(t.closeupHeight, 1.05), 2)
  }
  if (/\bmake it darker|darker|more night\b/.test(lower)) {
    kinds.push('CHANGE_LIGHTING')
    notes.push('Darken the look. Lighting stays planned, not a new render engine.')
  }
  if (/\bwalk slower|have (him|her|them) walk slower|slower walk\b/.test(lower)) {
    kinds.push('CHANGE_SUBJECT_PATH')
    timingDelta.walkArriveSec = round(Math.min(t.collapseSec - 0.3, t.walkArriveSec + 0.8), 2)
    notes.push('Walk slower along the same path.')
  }
  if (/\bmore dramatic|ending more dramatic\b/.test(lower)) {
    kinds.push('CHANGE_SHOT')
    notes.push('Hold the final close-up longer and keep the collapse in frame.')
  }
  if (/\buse ra'?el\b/.test(lower)) {
    kinds.push('CHANGE_ACTING')
    notes.push("Keep Ra'el as the canonical lead. Identity is unchanged.")
  }

  if (kinds.includes('CHANGE_DESTRUCTION_TIMING') || kinds.includes('CHANGE_SUBJECT_PATH') || kinds.includes('CHANGE_SHOT_DURATION')) {
    let collapse = timingDelta.orbitEndSec ?? t.collapseSec
    if (!rightPieceLater && /\bcollapse(?: the building)? later|one second later\b/.test(lower)) collapse = (timingDelta.orbitEndSec ?? t.collapseSec) + 1
    if (/\breach the doorway before|reach the door before|ra'?el reach/.test(lower)) {
      const arrive = round(Math.max(t.walkArriveSec, 6.2), 2)
      timingDelta.walkArriveSec = arrive
      collapse = Math.max(collapse, arrive + 0.9)
    }
    if (timingDelta.orbitEndSec != null) collapse = Math.max(collapse, timingDelta.orbitEndSec)
    if (timingDelta.walkArriveSec != null) collapse = Math.max(collapse, timingDelta.walkArriveSec + 0.4)
    lockCollapseDependents(timingDelta, collapse, t.durationSec, kinds)
    linked.push('destruction.start', 'camera.retreat', 'vfx.shake', 'vfx.dust', 'crowd.react', 'actor.reaction', 'shot-4', 'shot-3')
    notes.push(`Collapse at ${timingDelta.collapseSec}s. Retreat, impact, dust, and crowd stay locked to that time.`)
  }

  if (kinds.includes('CHANGE_ACTING')) {
    timingDelta.lookBackSec = round((timingDelta.collapseSec ?? t.collapseSec) + 0.15, 2)
    timingDelta.turnToCameraSec = round((timingDelta.collapseSec ?? t.collapseSec) + 0.9, 2)
    linked.push('actor.lookBack', 'actor.gaze', 'beat-3')
  }

  if (!kinds.length) {
    kinds.push('CHANGE_SHOT')
    notes.push('Director will interpret that note against the current plan.')
  }

  return {
    id: did('dpatch'),
    planId: plan.id,
    prompt,
    kinds: [...new Set(kinds)],
    summary: notes.join(' '),
    directorChoice,
    timingDelta,
    linkedUpdates: [...new Set(linked)],
    status: 'proposed',
    approvalRequired: true,
    createdAt: new Date().toISOString(),
  }
}

export function applyDirectorPlanPatch(plan: HvsDirectorPlan, patch: HvsDirectorPlanPatch): HvsDirectorPlan {
  const next = buildDirectorPlan({
    prompt: plan.prompt,
    projectId: plan.projectId,
    identityRef: plan.characters[0]?.identityRef ?? plan.castRefs[0],
    timing: { ...plan.timing, ...patch.timingDelta },
  })
  next.id = plan.id
  next.sceneId = plan.sceneId
  next.createdAt = plan.createdAt
  next.status = 'proposed'
  next.updatedAt = new Date().toISOString()
  if (patch.directorChoice && next.shots[4]) {
    next.shots[4] = { ...next.shots[4], directorReason: `${next.shots[4].directorReason} ${patch.directorChoice}` }
  }
  return next
}
