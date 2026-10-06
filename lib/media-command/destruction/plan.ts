import { sha256Json, shortId } from './hash'
import { guidesFromIntentParts } from './guides'
import { impulseClassForSeverity } from './intent'
import { materialPreset } from './materials'
import type { HvsDestructionIntent, HvsDestructionPlan, HvsMaterialId } from './types'
import { HVS_PREVIS_SOLVER_ID, HVS_PREVIS_SOLVER_VERSION } from './types'

function materialId(intent: HvsDestructionIntent): HvsMaterialId {
  return intent.materialOverrides.FULL ?? intent.materialOverrides.FRONT ?? 'CONCRETE'
}

export function planHash(plan: HvsDestructionPlan): string {
  return sha256Json({
    version: plan.version,
    fracturePlan: plan.fracturePlan,
    supportPlan: plan.supportPlan,
    constraintPlan: plan.constraintPlan,
    forcePlan: plan.forcePlan,
    guidePlan: plan.guidePlan,
    debrisPlan: plan.debrisPlan,
    secondaryFxPlan: plan.secondaryFxPlan,
    cameraFxPlan: plan.cameraFxPlan,
    simulationConfig: plan.simulationConfig,
    materialAssignments: plan.materialAssignments,
    performanceTier: plan.performanceTier,
  })
}

export function simConfigHash(plan: HvsDestructionPlan): string {
  return sha256Json(plan.simulationConfig)
}

export function materialHash(plan: HvsDestructionPlan): string {
  return sha256Json(plan.materialAssignments)
}

export function buildDestructionPlan(intent: HvsDestructionIntent, now = new Date().toISOString()): HvsDestructionPlan {
  const material = materialId(intent)
  const preset = materialPreset(material)
  const impulse = impulseClassForSeverity(intent.severity)
  const direction = intent.directionHint ?? { x: 0, y: -0.15, z: 1 }
  const guides = guidesFromIntentParts({
    prompt: intent.description,
    durationSec: intent.durationSec,
    direction,
    impulseClass: impulse,
  })
  const holdRight = guides.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT')
  const debrisBoost = intent.description.toLowerCase().includes('debris')
  const steps = [
    'Fracture the wall',
    holdRight ? 'Keep the right support intact' : 'Release supports with the collapse',
    intent.description.toLowerCase().includes('left') ? 'Break the left support first' : 'Break the wall in the requested order',
    'Simulate collapse',
    debrisBoost ? 'Generate debris when the wall hits the ground' : 'Generate debris',
    'Prepare dust cues',
    'Build a previs',
  ]
  const plan: HvsDestructionPlan = {
    id: shortId('dplan', { intentId: intent.id, version: 1, guides, material, duration: intent.durationSec }),
    intentId: intent.id,
    version: 1,
    summary: commanderSummary(intent),
    commanderSteps: steps,
    targetAssets: intent.targetAssetIds,
    materialAssignments: [{ region: 'FULL', materialId: material }],
    fracturePlan: {
      method: intent.description.toLowerCase().includes('guided fracture') ? 'GUIDED' : 'GRID',
      seed: Number.parseInt(sha256Json(intent.description).slice(0, 8), 16) % 100000,
      chunkTarget: 60,
      hierarchyDepth: 1,
      region: 'FULL',
      materialId: material,
      preFractureOnly: true,
      runtimeFracture: false,
    },
    supportPlan: {
      left: { region: 'LEFT', anchor: 'WORLD' },
      right: { region: 'RIGHT', anchor: 'WORLD', holdForShot: holdRight },
    },
    constraintPlan: {
      defaultStrengthClass: preset.constraintStrengthClass,
      breakThresholdClass: preset.constraintStrengthClass,
    },
    forcePlan: {
      gravity: 9.81,
      impulseClass: impulse,
      direction,
      cinematicForceOnly: true,
    },
    guidePlan: { primitives: guides },
    debrisPlan: {
      primary: 'PRIMARY_CHUNKS',
      secondary: 'SECONDARY_DEBRIS',
      secondaryBudget: debrisBoost ? 18 : 8,
    },
    secondaryFxPlan: {
      dust: true,
      smoke: false,
      dustClass: includesHarder(intent) ? 'STRONG' : preset.dustClass === 'HEAVY' ? 'MODERATE' : 'GENTLE',
      volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE',
    },
    audioCuePlan: { contractOnly: true, soundLibraryBound: false },
    cameraFxPlan: {
      shakeClass: impulse,
      grit: true,
      haze: preset.dustClass !== 'NONE',
    },
    simulationConfig: {
      durationSec: intent.durationSec,
      timeStep: 1 / 120,
      substeps: 5,
      fps: 24,
      seed: Number.parseInt(sha256Json(intent.id).slice(0, 6), 16) % 100000,
      mode: intent.mode,
      gravity: 9.81,
      sleepSpeed: 0.28,
      backend: HVS_PREVIS_SOLVER_ID,
      backendVersion: HVS_PREVIS_SOLVER_VERSION,
    },
    cachePolicy: {
      embedBytesInHvsproj: false,
      invalidateOn: [
        'plan',
        'sourceGeometryHash',
        'materialAssignment',
        'structuralGraph',
        'backendSemanticVersion',
        'simulationConfig',
      ],
      ignore: ['ColorPipeline', 'audioMix', 'captions', 'lookTint', 'audioCueBinding'],
    },
    backendRequirements: {
      fracture: 'INTERNAL_PRIMITIVE',
      physics: HVS_PREVIS_SOLVER_ID,
      volume: 'VOLUME_EXECUTION_NOT_AVAILABLE',
      previs: 'THREE_JS',
    },
    performanceTier: intent.performanceTier,
    operationalSupport: intent.performanceTier === 'SMALL',
    status: 'DRAFT',
    createdAt: now,
  }
  return plan
}

function includesHarder(intent: HvsDestructionIntent): boolean {
  return intent.description.toLowerCase().includes('harder') || intent.severity >= 0.85
}

export function commanderSummary(intent: HvsDestructionIntent): string {
  const seconds = intent.durationSec.toFixed(1)
  if (intent.destructionClass === 'WALL' || intent.destructionClass === 'FACADE') {
    return `Front wall collapse — ${seconds} sec`
  }
  return `Destruction previs — ${seconds} sec`
}

export function validateDestructionPlan(plan: HvsDestructionPlan): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!plan.id || !plan.intentId) errors.push('ids')
  if (plan.fracturePlan.runtimeFracture !== false || plan.fracturePlan.preFractureOnly !== true) errors.push('prefracture')
  if (plan.fracturePlan.chunkTarget < 1 || plan.fracturePlan.chunkTarget > 150) errors.push('chunks')
  if (!plan.forcePlan.cinematicForceOnly) errors.push('force')
  if (plan.cachePolicy.embedBytesInHvsproj !== false) errors.push('embed')
  if (plan.simulationConfig.backend !== 'HVS_PREVIS_SOLVER') errors.push('solver-label')
  if (plan.performanceTier !== 'SMALL' && plan.operationalSupport) errors.push('tier-support')
  return { ok: errors.length === 0, errors }
}
