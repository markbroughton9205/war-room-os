/**
 * Advisory capability gate: planner may consult Atlas, Atlas may not command.
 * Does not approve tools, production, deploy, or Commander authorization.
 */
import { ENGINEERING_MEMORY_BOUNDARY } from './memoryBoundary'
import { planSkillAcquisition } from './acquisition'
import { buildSkillPack, resolveMissionSkills, toGap } from './resolver'
import { loadCapabilityAtlas, type CapabilityAtlas } from './store'
import { CAPABILITY_GATE_AUTHORITY, type CapabilityAssessment, type CapabilityRecommendation, type CapabilityStatus, type SkillGap, type SkillPack, type SkillResolution } from './types'

const PACK_LIMIT = 12
const WORKSPACE_CONTEXT_LIMIT = 400

export type PlannerCapabilityInput = {
  missionText: string
  missionKind?: string
  workspaceContext?: string
  requestedTools?: string[]
  requestedSkillIds?: string[]
  requiredVerification?: string[]
  repoTruth?: string
  atlas?: CapabilityAtlas
}

export const PLANNER_CAPABILITY_GATE = {
  advisory: true,
  autoTrustResearch: false,
  globalResearch: false,
  wrimTraining: false,
  terra: false,
  authority: CAPABILITY_GATE_AUTHORITY,
  conflictPolicy: ENGINEERING_MEMORY_BOUNDARY.conflictPolicy,
  blocksCommanderProjects: false,
  isPermissionWhitelist: false,
} as const

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

function dropConfidence(level: CapabilityAssessment['confidence']): CapabilityAssessment['confidence'] {
  if (level === 'high') return 'medium'
  if (level === 'medium') return 'low'
  return 'low'
}

export function isProductionProofMission(input: PlannerCapabilityInput): boolean {
  const text = input.missionText
  if (/live deploy|install and activate|activate this build|production install|live browser acceptance|live computer use/i.test(text)) return true
  if (/\bnot a production( install)?\b/i.test(text)) return false
  const ver = input.requiredVerification ?? []
  if (input.missionKind === 'application' && (ver.includes('install') || ver.includes('computer') || ver.includes('package'))) return true
  return false
}

export function inferSkillHints(input: PlannerCapabilityInput): string[] {
  const text = `${input.missionText} ${input.workspaceContext ?? ''} ${(input.requestedTools ?? []).join(' ')}`
  const ids = [...(input.requestedSkillIds ?? [])]
  if (/cuda|\bgpu\b|oom|vram/i.test(text)) ids.push('ml.cuda', 'ml.training.memory', 'performance.gpu-memory', 'debugging.runtime', 'ml.training')
  if (/linux service|systemd/i.test(text)) ids.push('os.linux', 'os.linux.systemd', 'os.system-services', 'debugging.runtime')
  if (/kernel module/i.test(text)) ids.push('kernel.module-build', 'software.languages.c')
  if (/kernel driver/i.test(text)) ids.push('kernel.device-drivers', 'kernel.module-build', 'software.languages.c')
  if (/usb driver/i.test(text)) ids.push('kernel.device-drivers.usb', 'kernel.device-drivers', 'software.languages.c', 'debugging.runtime')
  if (/postgresql|postgres/i.test(text)) ids.push('database.postgresql', 'database.query-planning', 'debugging.runtime')
  if (/optimize this slow postgresql query|query-optimization|query optimization/i.test(text)) ids.push('database.query-optimization')
  if (/react[^\n]{0,80}rerender|rerender[^\n]{0,80}react/i.test(text)) ids.push('frontend.react.performance', 'debugging.runtime')
  if (/build a react application|production-style react|react interface/i.test(text)) ids.push('frontend.react', 'debugging.runtime')
  if (/http\/?3|\bhttp3\b/i.test(text)) ids.push('networking.http3', 'debugging.runtime')
  if (/\bquic\b/i.test(text)) ids.push('networking.quic', 'debugging.runtime')
  if (/\bllvm\b/i.test(text)) ids.push('compiler.llvm.optimization', 'debugging.runtime')
  if (/llvm pipeline/i.test(text)) ids.push('compiler.llvm')
  if (/pytorch/i.test(text)) ids.push('ml.pytorch', 'ml.training', 'debugging.runtime')
  if (/concurrent go service|\bgolang\b|\bgo service\b/i.test(text)) ids.push('software.languages.go', 'debugging.runtime')
  if (/tls handshake|fix a tls\b/i.test(text)) ids.push('networking.tls', 'debugging.runtime')
  if (/performance bottleneck|\bprofil/i.test(text)) ids.push('performance.profiling', 'debugging.runtime')
  if (/\brust\b/i.test(text) && /ownership|borrow|cargo|lifetime/i.test(text)) ids.push('software.languages.rust', 'debugging.runtime')
  if (/bounded.?edit|foundry ui text|exact [^\n]{0,40}text/i.test(text) && /foundry|ui text|safely|replace/i.test(text)) {
    ids.push('foundry.bounded-edit', 'foundry.binding-protection', 'software.languages.typescript')
  }
  if (isProductionProofMission(input)) {
    ids.push('release.production-activation', 'foundry.production-lease', 'release.packaging')
  }
  if (/computer.?use|at-spi/i.test(text)) ids.push('foundry.computer-use-atspi')
  if (/playwright|browser acceptance/i.test(text)) ids.push('foundry.browser-playwright', 'testing.browser-automation')
  if (/write-?set|tool broker/i.test(text)) ids.push('foundry.tool-broker-governance')
  return unique(ids)
}

export function buildResolverMission(input: PlannerCapabilityInput): string {
  const parts = [input.missionText.trim()]
  if (input.missionKind) parts.push(`mission kind: ${input.missionKind}`)
  if (input.workspaceContext?.trim()) parts.push(`workspace: ${input.workspaceContext.trim().slice(0, WORKSPACE_CONTEXT_LIMIT)}`)
  if (input.requestedTools?.length) parts.push(`requested tools: ${input.requestedTools.slice(0, 12).join(' ')}`)
  const hints = inferSkillHints(input)
  if (hints.length) parts.push(`requested skills: ${hints.join(' ')}`)
  return parts.join('\n')
}

function applyRepoTruth(required: string[], repoTruth?: string): { required: string[]; notes: string[] } {
  const notes: string[] = []
  if (!repoTruth?.trim()) return { required, notes }
  let next = [...required]
  if (/vanilla html|plain html|not react|no react/i.test(repoTruth)) {
    const dropped = next.filter(id => id === 'frontend.react' || id === 'frontend.nextjs')
    if (dropped.length) {
      next = next.filter(id => id !== 'frontend.react' && id !== 'frontend.nextjs')
      notes.push(`${ENGINEERING_MEMORY_BOUNDARY.conflictPolicy}: Engineering Memory says this workspace is vanilla HTML; Atlas React/Next assumptions are not used for this mission. Dropped ${dropped.join(', ')}.`)
    }
  }
  return { required: next, notes }
}

function statusOf(atlas: CapabilityAtlas, skillId: string): CapabilityStatus | 'UNREGISTERED' {
  return atlas.skills.get(skillId)?.capabilityStatus ?? 'UNREGISTERED'
}

function isHardGapStatus(status: CapabilityStatus | 'UNREGISTERED'): boolean {
  return status === 'DISCOVERED' || status === 'SOURCE_BACKED' || status === 'LEARNABLE' || status === 'STALE' || status === 'FAILED' || status === 'UNSUPPORTED' || status === 'UNREGISTERED'
}

function classifyRecommendation(input: {
  required: string[]
  atlas: CapabilityAtlas
  hardGaps: SkillGap[]
  productionProofMissing: string[]
  needsValidation: boolean
}): CapabilityRecommendation {
  const statuses = input.required.map(id => statusOf(input.atlas, id))
  if (statuses.includes('UNSUPPORTED')) return 'CAPABILITY_UNSUPPORTED'
  if (input.hardGaps.some(gap => gap.currentStatus === 'LEARNABLE' || gap.currentStatus === 'SOURCE_BACKED')) return 'CAPABILITY_RESEARCH_REQUIRED'
  if (input.hardGaps.length || input.productionProofMissing.length) return 'CAPABILITY_GAP'
  if (input.needsValidation) return 'CAPABILITY_READY_WITH_VALIDATION'
  return 'CAPABILITY_READY'
}

export function loadMissionSkillPacks(atlas: CapabilityAtlas, skillIds: string[]): SkillPack[] {
  return unique(skillIds).slice(0, PACK_LIMIT).map(id => buildSkillPack(atlas, id)).filter((pack): pack is SkillPack => Boolean(pack))
}

export function assessMissionCapabilities(input: PlannerCapabilityInput): CapabilityAssessment {
  const atlas = input.atlas ?? loadCapabilityAtlas()
  const resolverMission = buildResolverMission(input)
  const resolution: SkillResolution = resolveMissionSkills(atlas, resolverMission)
  const inferred = inferSkillHints(input)
  const hintedRequired = unique(inferred)
  const truth = applyRepoTruth(hintedRequired.length ? hintedRequired : unique(resolution.primarySkills), input.repoTruth)
  const required = truth.required
  const extraPrimary = resolution.primarySkills.filter(id => !required.includes(id))
  const secondary = unique([...resolution.secondarySkills, ...extraPrimary].filter(id => !required.includes(id)))
  const optional = unique(resolution.optionalSkills.filter(id => !required.includes(id) && !secondary.includes(id)))

  const gapBySkill = new Map(resolution.missingSkills.map(gap => [gap.skillId, gap]))
  const hardGaps: SkillGap[] = []
  for (const skillId of required) {
    const status = statusOf(atlas, skillId)
    if (!isHardGapStatus(status)) continue
    hardGaps.push({
      ...(gapBySkill.get(skillId) ?? toGap(atlas, skillId, input.missionText, `Required skill is ${status}; Foundry must not pretend competence.`)),
      requiredForMission: input.missionText,
    })
  }

  const productionMission = isProductionProofMission(input)
  const productionProofMissing = productionMission
    ? required.filter(id => statusOf(atlas, id) !== 'PRODUCTION_PROVEN')
    : []
  if (productionMission) {
    for (const skillId of productionProofMissing) {
      const why = `PRODUCTION_PROOF_REQUIRED: ${skillId} is ${statusOf(atlas, skillId)}, not PRODUCTION_PROVEN. Implementation files are not production proof. Authorization remains separate.`
      const existing = hardGaps.find(gap => gap.skillId === skillId)
      if (existing) {
        if (!existing.why.includes('PRODUCTION_PROOF_REQUIRED')) existing.why = `${existing.why} ${why}`
        continue
      }
      hardGaps.push({
        kind: 'SKILL_GAP',
        skillId,
        requiredForMission: input.missionText,
        currentStatus: statusOf(atlas, skillId),
        availableSources: gapBySkill.get(skillId)?.availableSources ?? [],
        researchRequired: false,
        evaluationRequired: true,
        why,
      })
    }
  }

  const secondaryGaps = secondary.filter(id => isHardGapStatus(statusOf(atlas, id)))
  const provenSkills = required.filter(id => statusOf(atlas, id) === 'PROVEN' || statusOf(atlas, id) === 'PRODUCTION_PROVEN')
  const evaluatedSkills = required.filter(id => statusOf(atlas, id) === 'EVALUATED' || statusOf(atlas, id) === 'AVAILABLE' || statusOf(atlas, id) === 'EVALUATION_PENDING')
  const needsValidation = evaluatedSkills.length > 0
  const recommendation = classifyRecommendation({ required, atlas, hardGaps, productionProofMissing, needsValidation })

  let confidence = resolution.confidence
  if (secondaryGaps.length) confidence = dropConfidence(confidence)
  if (hardGaps.length) confidence = 'low'

  const selectedPackSkillIds = unique([...required, ...secondary]).slice(0, PACK_LIMIT)
  const packs = loadMissionSkillPacks(atlas, selectedPackSkillIds)
  const acquisitionPlans = hardGaps
    .filter(gap => gap.currentStatus === 'LEARNABLE' || gap.currentStatus === 'DISCOVERED' || gap.currentStatus === 'SOURCE_BACKED')
    .map(planSkillAcquisition)

  const why = [
    ...resolution.why.slice(0, 16),
    `recommendation=${recommendation}`,
    `required=${required.join(',') || 'none'}`,
    productionMission ? 'PRODUCTION_PROOF_REQUIRED advisory for production-class steps' : 'not a production-proof mission',
    ...truth.notes,
    'Capability is advisory. It does not approve tools, production, deploy, or Commander authorization.',
    'Capability status is self-knowledge, not Commander permission. A missing skill triggers acquisition; it does not forbid the request.',
  ]

  return {
    requiredSkills: required,
    optionalSkills: optional,
    secondarySkills: secondary,
    missingSkills: hardGaps,
    provenSkills,
    evaluatedSkills,
    productionProofMissing,
    confidence,
    recommendation,
    why,
    productionProofRequired: productionProofMissing.length > 0,
    acquisitionPlans,
    selectedPackSkillIds,
    repoTruthNotes: truth.notes,
    resolverConfidence: resolution.confidence,
    autoTrustResearch: false,
    wrimTraining: false,
    terraMutation: false,
    globalResearchStarted: false,
    grantsAuthority: false,
    loadedPackCount: packs.length,
  }
}

export function persistableCapabilityAssessment(assessment: CapabilityAssessment): CapabilityAssessment {
  return {
    ...assessment,
    why: assessment.why.slice(0, 20),
    missingSkills: assessment.missingSkills.map(gap => ({
      ...gap,
      requiredForMission: gap.requiredForMission.slice(0, 400),
      availableSources: gap.availableSources.slice(0, 6),
    })),
    acquisitionPlans: assessment.acquisitionPlans.map(plan => ({
      ...plan,
      autoTrustResearch: false,
      wrimTraining: false,
      terraMutation: false,
      commit: false,
      push: false,
      sandboxEvaluationRequired: true,
    })),
  }
}
