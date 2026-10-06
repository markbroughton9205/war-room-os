import { shortId } from './hash'
import { materialHash, planHash } from './plan'
import type {
  HvsDestructionPlan,
  HvsDestructionPlanPatch,
  HvsGuidePrimitive,
  HvsMaterialId,
} from './types'

export function proposeDestructionPatch(plan: HvsDestructionPlan, prompt: string, now = new Date().toISOString()): HvsDestructionPlanPatch {
  const text = prompt.toLowerCase()
  const base = {
    id: shortId('dpatch', { planId: plan.id, prompt, version: plan.version }),
    planId: plan.id,
    prompt,
    approvalRequired: true as const,
    mutated: false as const,
    createdAt: now,
  }
  if (text.includes('right') && (text.includes('collapse') || text.includes('fall'))) {
    const delay = /one second/.test(text) ? 1 : 1
    return { ...base, kind: 'BREAK_REGION_FIRST', region: 'RIGHT', delaySec: delay, removesProtect: true }
  }
  if (text.includes('slower') || text.includes('faster') || text.includes('timing')) {
    return { ...base, kind: 'CHANGE_TIMING', durationSec: text.includes('slower') ? Math.min(12, plan.simulationConfig.durationSec + 2) : Math.max(2, plan.simulationConfig.durationSec - 1) }
  }
  if (text.includes('debris')) {
    return { ...base, kind: 'CHANGE_DEBRIS', debrisBudget: Math.min(48, plan.debrisPlan.secondaryBudget + 12) }
  }
  if (text.includes('dust')) {
    return { ...base, kind: 'CHANGE_DUST', dustClass: 'STRONG' }
  }
  if (text.includes('shake') || text.includes('camera')) {
    return { ...base, kind: 'CHANGE_CAMERA_SHAKE', shakeClass: 'STRONG' }
  }
  if (text.includes('protect') || text.includes('keep the')) {
    return { ...base, kind: 'PROTECT_REGION', region: text.includes('left') ? 'LEFT' : 'RIGHT' }
  }
  if (text.includes('glass') || text.includes('wood') || text.includes('metal') || text.includes('brick') || text.includes('material')) {
    const materialId: HvsMaterialId = text.includes('glass') ? 'GLASS' : text.includes('wood') ? 'WOOD' : text.includes('metal') ? 'METAL' : text.includes('brick') ? 'BRICK' : 'CONCRETE'
    return { ...base, kind: 'CHANGE_MATERIAL', materialId }
  }
  if (text.includes('direction') || text.includes('fall left') || text.includes('fall right')) {
    return { ...base, kind: 'CHANGE_DIRECTION', direction: text.includes('right') ? { x: 0.4, y: -0.2, z: 0.9 } : { x: -0.4, y: -0.2, z: 0.9 } }
  }
  if (text.includes('harder') || text.includes('severity')) {
    return { ...base, kind: 'CHANGE_SEVERITY', severity: Math.min(1, plan.forcePlan.impulseClass === 'STRONG' ? 1 : 0.9) }
  }
  return { ...base, kind: 'CHANGE_TIMING', durationSec: plan.simulationConfig.durationSec }
}

export function applyApprovedDestructionPatch(plan: HvsDestructionPlan, patch: HvsDestructionPlanPatch, approval: boolean, now = new Date().toISOString()): HvsDestructionPlan {
  if (approval !== true) throw new Error('Plan patch approval required.')
  if (patch.planId !== plan.id) throw new Error('Patch does not match this plan.')
  const next: HvsDestructionPlan = structuredClone(plan)
  next.version = plan.version + 1
  next.status = 'DRAFT'
  next.createdAt = now
  const guides = next.guidePlan.primitives
  if (patch.kind === 'BREAK_REGION_FIRST' && patch.region === 'RIGHT') {
    const left = guides.find(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'LEFT')
    const leftAt = left && left.kind === 'BREAK_FIRST' ? left.atSec : 0.4
    const atSec = leftAt + (patch.delaySec ?? 1)
    next.guidePlan.primitives = guides.filter(guide => !(
      (guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT')
      || (guide.kind === 'HOLD_UNTIL' && guide.region === 'RIGHT')
      || (guide.kind === 'RELEASE_AT' && guide.region === 'RIGHT')
    ))
    const release: HvsGuidePrimitive = { kind: 'RELEASE_AT', region: 'RIGHT', atSec }
    next.guidePlan.primitives.push(release)
    next.supportPlan.right.holdForShot = false
    next.commanderSteps = next.commanderSteps.map(step => step.startsWith('Keep the right') ? 'Release the right support one second after the left' : step)
  } else if (patch.kind === 'CHANGE_TIMING' && patch.durationSec) {
    next.simulationConfig = { ...next.simulationConfig, durationSec: patch.durationSec }
  } else if (patch.kind === 'CHANGE_DEBRIS' && patch.debrisBudget) {
    next.debrisPlan = { ...next.debrisPlan, secondaryBudget: patch.debrisBudget }
  } else if (patch.kind === 'CHANGE_DUST' && patch.dustClass) {
    next.secondaryFxPlan = { ...next.secondaryFxPlan, dustClass: patch.dustClass, dust: true }
  } else if (patch.kind === 'CHANGE_CAMERA_SHAKE' && patch.shakeClass) {
    next.cameraFxPlan = { ...next.cameraFxPlan, shakeClass: patch.shakeClass }
  } else if (patch.kind === 'PROTECT_REGION' && patch.region) {
    next.guidePlan.primitives.push({ kind: 'PROTECT_REGION', region: patch.region })
    if (patch.region === 'RIGHT') next.supportPlan.right.holdForShot = true
  } else if (patch.kind === 'CHANGE_MATERIAL' && patch.materialId) {
    next.materialAssignments = [{ region: 'FULL', materialId: patch.materialId }]
    next.fracturePlan = { ...next.fracturePlan, materialId: patch.materialId }
  } else if (patch.kind === 'CHANGE_DIRECTION' && patch.direction) {
    next.forcePlan = { ...next.forcePlan, direction: patch.direction }
  } else if (patch.kind === 'CHANGE_SEVERITY' && patch.severity != null) {
    next.forcePlan = { ...next.forcePlan, impulseClass: patch.severity >= 0.8 ? 'STRONG' : 'MODERATE' }
  }
  next.id = shortId('dplan', { intentId: plan.intentId, version: next.version, hash: planHash(next), material: materialHash(next) })
  next.summary = next.summary.replace(/— [\d.]+ sec/, `— ${next.simulationConfig.durationSec.toFixed(1)} sec`)
  return next
}
