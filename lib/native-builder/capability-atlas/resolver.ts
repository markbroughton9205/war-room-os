import type { CapabilityAtlas } from './store'
import type { SkillGap, SkillPack, SkillRecord, SkillResolution } from './types'
import { findTaxonomyNodes } from './taxonomy'
import { walkPrerequisites } from './graph'

const MATURE_ENOUGH = new Set(['AVAILABLE', 'EVALUATION_PENDING', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN'])

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9.+#/-]+/i).filter(token => token.length >= 2)
}

function scoreSkill(mission: string, skill: SkillRecord, taxonomyHits: Set<string>): number {
  const hay = `${skill.skillId} ${skill.name} ${skill.description} ${skill.languages.join(' ')} ${skill.frameworks.join(' ')} ${skill.tools.join(' ')}`.toLowerCase()
  let score = 0
  for (const token of tokens(mission)) {
    if (skill.skillId === token || skill.skillId.endsWith(`.${token}`)) score += 8
    if (hay.includes(token)) score += 2
  }
  if (taxonomyHits.has(skill.skillId)) score += 6
  return score
}

export function resolveMissionSkills(atlas: CapabilityAtlas, mission: string): SkillResolution {
  const taxonomyHits = new Set(findTaxonomyNodes(mission).map(node => node.id))
  const scored = [...atlas.skills.values()]
    .map(skill => ({ skill, score: scoreSkill(mission, skill, taxonomyHits) }))
    .filter(item => item.score >= 4)
    .sort((a, b) => b.score - a.score)

  const primary: string[] = []
  const secondary: string[] = []
  const optional: string[] = []
  const missing: SkillGap[] = []
  const why: string[] = []

  for (const hit of scored.slice(0, 16)) {
    const prereq = walkPrerequisites(hit.skill.skillId, atlas.relationships, new Set(atlas.skills.keys()))
    if (prereq.cycle) why.push(`CYCLE_DETECTED ${prereq.cycle.join(' -> ')}`)
    for (const id of prereq.missing) {
      missing.push(toGap(atlas, id, mission, 'Prerequisite is not registered.'))
    }
    const status = hit.skill.capabilityStatus
    if (!MATURE_ENOUGH.has(status) || status === 'FAILED' || status === 'UNSUPPORTED' || status === 'STALE') {
      if (status === 'DISCOVERED' || status === 'SOURCE_BACKED' || status === 'LEARNABLE' || status === 'FAILED' || status === 'UNSUPPORTED' || status === 'STALE') {
        missing.push(toGap(atlas, hit.skill.skillId, mission, `Required skill is ${status}; Foundry must not pretend competence.`))
      }
    }
    if (hit.score >= 10) primary.push(hit.skill.skillId)
    else if (hit.score >= 6) secondary.push(hit.skill.skillId)
    else optional.push(hit.skill.skillId)
    why.push(`${hit.skill.skillId} score=${hit.score} status=${status}`)
  }

  if (!scored.length) {
    for (const node of [...taxonomyHits].slice(0, 8)) {
      missing.push(toGap(atlas, node, mission, 'Taxonomy matched but no usable capability is available.'))
      why.push(`taxonomy ${node}`)
    }
  }

  const uniqueMissing = [...new Map(missing.map(item => [item.skillId, item])).values()]
  return {
    mission,
    primarySkills: unique(primary),
    secondarySkills: unique(secondary.filter(id => !primary.includes(id))),
    optionalSkills: unique(optional.filter(id => !primary.includes(id) && !secondary.includes(id))),
    missingSkills: uniqueMissing,
    confidence: uniqueMissing.length && !primary.length ? 'low' : primary.length ? 'medium' : 'low',
    why,
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

export function toGap(atlas: CapabilityAtlas, skillId: string, mission: string, why: string): SkillGap {
  const skill = atlas.skills.get(skillId)
  const sources = [...atlas.sources.values()].filter(source => source.skillIds.includes(skillId) || skill?.officialSources.includes(source.sourceId))
  return {
    kind: 'SKILL_GAP',
    skillId,
    requiredForMission: mission,
    currentStatus: skill?.capabilityStatus ?? 'UNREGISTERED',
    availableSources: sources.map(source => source.sourceUrl),
    researchRequired: sources.length === 0 || !skill || skill.capabilityStatus === 'DISCOVERED',
    evaluationRequired: !skill || !['EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN'].includes(skill.capabilityStatus),
    why,
  }
}

export function detectSkillGaps(atlas: CapabilityAtlas, mission: string): SkillGap[] {
  return resolveMissionSkills(atlas, mission).missingSkills
}

const PACK_GUIDANCE_LIMIT = 900

export function buildSkillPack(atlas: CapabilityAtlas, skillId: string): SkillPack | null {
  const skill = atlas.skills.get(skillId)
  if (!skill) return null
  const sources = [...atlas.sources.values()]
    .filter(source => source.skillIds.includes(skillId) || skill.officialSources.includes(source.sourceId) || skill.openSourceSources.includes(source.sourceId))
    .slice(0, 8)
    .map(source => ({ sourceId: source.sourceId, url: source.sourceUrl, authorityClass: source.authorityClass }))
  const guidance = [
    skill.description,
    skill.governanceRequirements[0] ?? '',
    'Load references; do not embed full documentation.',
    'Repo-specific truth is Engineering Memory, not this pack.',
  ].filter(Boolean).join(' ').slice(0, PACK_GUIDANCE_LIMIT)

  return {
    packId: `${skill.skillId}@${skill.version}`,
    skillId: skill.skillId,
    version: skill.version,
    metadata: {
      name: skill.name,
      domain: skill.domain,
      status: skill.capabilityStatus,
      confidence: skill.confidence,
      modelRouting: skill.modelRouting,
    },
    officialSources: sources,
    knownToolCommands: skill.supportedToolBrokerTools.slice(0, 12),
    commonFailurePatterns: skill.knownFailureModes.slice(0, 8),
    validationMethods: skill.validationMethods.slice(0, 8),
    relevantRepoOwnershipMemory: skill.engineeringMemoryLinks.slice(0, 6),
    relatedTests: skill.evidence.validators.slice(0, 8),
    briefProceduralGuidance: guidance,
    compact: true,
  }
}

export function skillPackIsCompact(pack: SkillPack, maxBytes = 8_192): boolean {
  return Buffer.byteLength(JSON.stringify(pack), 'utf8') <= maxBytes && pack.compact === true && pack.briefProceduralGuidance.length <= PACK_GUIDANCE_LIMIT
}
