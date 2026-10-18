import type { CapabilityAtlas } from './store'
import type { CapabilityStatus, SkillRecord } from './types'
import { buildCapabilityScoreboard } from './scoreboard'
import { resolveMissionSkills } from './resolver'

export type SelfKnowledgeAnswer = {
  question: string
  skills: Array<Pick<SkillRecord, 'skillId' | 'name' | 'capabilityStatus' | 'confidence' | 'modelRouting'>>
  notes: string[]
}

function summarize(skills: SkillRecord[]) {
  return skills.map(skill => ({
    skillId: skill.skillId,
    name: skill.name,
    capabilityStatus: skill.capabilityStatus,
    confidence: skill.confidence,
    modelRouting: skill.modelRouting,
  }))
}

function byStatus(atlas: CapabilityAtlas, statuses: CapabilityStatus[]): SkillRecord[] {
  return [...atlas.skills.values()].filter(skill => statuses.includes(skill.capabilityStatus)).sort((a, b) => a.skillId.localeCompare(b.skillId))
}

export function answerCodingSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  const available = byStatus(atlas, ['AVAILABLE', 'EVALUATION_PENDING', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN'])
  return {
    question: 'What coding skills do you have?',
    skills: summarize(available),
    notes: [
      'Registered taxonomy skills are not listed here unless they are at least AVAILABLE.',
      'AVAILABLE means implementation evidence and broker tools exist, not that the skill is mastered.',
    ],
  }
}

export function answerProvenSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What have you actually proven?',
    skills: summarize(byStatus(atlas, ['PROVEN', 'PRODUCTION_PROVEN'])),
    notes: ['Empty is honest. Proof requires a passing INTEGRATION_EVAL. PRODUCTION_PROVEN also needs PRODUCTION_EVAL and named missions.'],
  }
}

export function answerRegisteredSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills are registered?',
    skills: summarize([...atlas.skills.values()].sort((a, b) => a.skillId.localeCompare(b.skillId))),
    notes: ['Registered includes taxonomy leaves and source-backed skills. Registration is not mastery.'],
  }
}

export function answerSourceBackedSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills are merely source-backed?',
    skills: summarize(byStatus(atlas, ['SOURCE_BACKED', 'LEARNABLE'])),
    notes: ['SOURCE_BACKED/LEARNABLE means official docs exist. No local implementation evaluation has been recorded.'],
  }
}

export function answerEvaluatedSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills are evaluated?',
    skills: summarize(byStatus(atlas, ['EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN'])),
    notes: ['EVALUATED includes PARTIAL and CODE_EVAL results. PROVEN requires a passing INTEGRATION_EVAL.'],
  }
}

export function answerProductionProvenSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills are production-proven?',
    skills: summarize(byStatus(atlas, ['PRODUCTION_PROVEN'])),
    notes: ['PRODUCTION_PROVEN requires a passing PRODUCTION_EVAL and named production proof missions.'],
  }
}

export function answerFailedSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills failed evaluation?',
    skills: summarize(byStatus(atlas, ['FAILED'])),
    notes: ['FAIL does not promote. Repair the skill or validator; do not weaken the Atlas.'],
  }
}

export function answerLocalSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  const skills = [...atlas.skills.values()].filter(skill => skill.modelRouting.includes('LOCAL_MODEL_OK') || skill.modelRouting.includes('FOUNDRY_NATIVE_PROVEN'))
    .filter(skill => ['AVAILABLE', 'EVALUATED', 'PROVEN', 'PRODUCTION_PROVEN'].includes(skill.capabilityStatus))
  return {
    question: 'What can you do locally?',
    skills: summarize(skills),
    notes: ['Local/WRIM routing is declared per skill. Cursor is not the default for every skill.'],
  }
}

export function answerExternalHelp(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  const skills = [...atlas.skills.values()].filter(skill => skill.modelRouting.includes('FRONTIER_RECOMMENDED') || skill.modelRouting.includes('SPECIALIST_TOOL_REQUIRED'))
  return {
    question: 'What requires external help?',
    skills: summarize(skills.filter(skill => skill.capabilityStatus !== 'DISCOVERED').slice(0, 80)),
    notes: ['Frontier/specialist routing is a recommendation, not a completed evaluation.'],
  }
}

export function answerNeverTested(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What have you never tested?',
    skills: summarize(byStatus(atlas, ['DISCOVERED', 'SOURCE_BACKED', 'LEARNABLE', 'AVAILABLE'])),
    notes: ['AVAILABLE still means untested unless an evaluation record exists.'],
  }
}

export function answerStaleSkills(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  return {
    question: 'What skills are stale?',
    skills: summarize(byStatus(atlas, ['STALE'])),
    notes: ['Stale is driven by source freshness, not calendar guesswork.'],
  }
}

export function answerMissionSkills(atlas: CapabilityAtlas, mission: string) {
  return resolveMissionSkills(atlas, mission)
}

export function answerLearnNext(atlas: CapabilityAtlas): SelfKnowledgeAnswer {
  const gaps = byStatus(atlas, ['DISCOVERED', 'SOURCE_BACKED', 'LEARNABLE']).filter(skill => skill.officialSources.length > 0 || skill.capabilityClass !== 'DISCOVERED_TAXONOMY')
  return {
    question: 'What should you learn next?',
    skills: summarize(gaps.slice(0, 24)),
    notes: [
      'Next research mission: FOUNDRY CODING CAPABILITY ATLAS GLOBAL SOFTWARE KNOWLEDGE DISCOVERY.',
      'Do not start that swarm from this foundation pass.',
    ],
  }
}

export function selfKnowledgeBundle(atlas: CapabilityAtlas, mission?: string) {
  return {
    scoreboard: buildCapabilityScoreboard(atlas),
    registered: answerRegisteredSkills(atlas),
    sourceBacked: answerSourceBackedSkills(atlas),
    have: answerCodingSkills(atlas),
    evaluated: answerEvaluatedSkills(atlas),
    proven: answerProvenSkills(atlas),
    productionProven: answerProductionProvenSkills(atlas),
    local: answerLocalSkills(atlas),
    external: answerExternalHelp(atlas),
    neverTested: answerNeverTested(atlas),
    failed: answerFailedSkills(atlas),
    stale: answerStaleSkills(atlas),
    mission: mission ? answerMissionSkills(atlas, mission) : null,
    learnNext: answerLearnNext(atlas),
  }
}
