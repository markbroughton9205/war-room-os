/**
 * Mission Contract — canonical understanding artifact after classification, before planning.
 * Distinguishes REQUIREMENT vs ASSUMPTION and KNOWN vs UNKNOWN. Does not invent requirements.
 */

import type { EbcMissionClass } from '@/lib/council/evidence-board/types'
import { MISSION_CONTRACT_SCHEMA, type AuthorityLevel, type MissionAuthority, type MissionContractRevision, type MissionContractV1 } from './types'
import type { IntelligenceMissionClass } from './types'

const EXCLUSION =
  /\b(?:do not|don't|without|exclude|out of scope|no commit|no push|no deploy|not authorized)\b/i
const COMMIT_NO = /\b(?:do not commit|commit no|no commit|not authorized:\s*commit)\b/i
const PUSH_NO = /\b(?:do not push|push no|no push)\b/i
const DEPLOY_NO = /\b(?:do not (?:live )?deploy|deploy no|no (?:production )?deploy|not authorized:\s*production)\b/i

const DEFAULT_AUTHORITY: MissionAuthority = Object.freeze({
  local_repair: true,
  commit: false,
  push: false,
  production_deploy: false,
  spend: false,
  trade: false,
  wager: false,
  settlement_submit: false,
  irreversible_external: false,
  commander_override: false,
})

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))]
}

function extractExclusions(text: string): string[] {
  const found: string[] = []
  if (COMMIT_NO.test(text) || /\bcommit\s+no\b/i.test(text)) found.push('commit')
  if (PUSH_NO.test(text) || /\bpush\s+no\b/i.test(text)) found.push('push')
  if (DEPLOY_NO.test(text) || /\bproduction deploy no\b/i.test(text)) found.push('production deploy')
  if (/\bterra\b/i.test(text) && EXCLUSION.test(text) && /\bterra\b/i.test(text)) found.push('Terra feature work')
  if (/\bfoundry\b/i.test(text) && /(?:do not|don't|exclude|out of scope)/i.test(text)) found.push('Foundry feature work')
  if (/\bwrim\b/i.test(text) && /(?:do not|don't|exclude|training)/i.test(text)) found.push('WRIM training')
  if (/\bno mutation\b|\bwithout changing the system\b|\bread-only\b/i.test(text)) found.push('system mutation')
  return unique(found)
}

function extractRequirements(text: string): string[] {
  const found: string[] = []
  if (/\bevidence[- ]backed\b/i.test(text)) found.push('evidence-backed recommendation')
  if (/\b3847\b/.test(text) || /\b3848\b/.test(text)) found.push('prove 3847/3848 ownership when runtime is in scope')
  if (/\bprimary sources?\b/i.test(text)) found.push('primary sources')
  if (/\bwithout changing the system\b/i.test(text)) found.push('no system mutation')
  return found
}

function complexity(text: string, intelligenceClass: IntelligenceMissionClass): 'LOW' | 'MED' | 'HIGH' {
  if (intelligenceClass === 'SOCIAL_CHECKIN') return 'LOW'
  if (intelligenceClass === 'SYSTEM_STATUS' || intelligenceClass === 'CURRENT_INTEL') return 'MED'
  if (text.length > 400 || intelligenceClass === 'ENGINEERING_MISSION' || intelligenceClass === 'DEEP_RESEARCH') return 'HIGH'
  return 'MED'
}

function authorityFromText(text: string, intelligenceClass: IntelligenceMissionClass): { level: AuthorityLevel; authority: MissionAuthority; approvals: string[] } {
  const authority: MissionAuthority = { ...DEFAULT_AUTHORITY }
  const approvals: string[] = ['commit', 'push', 'production deploy', 'spend', 'trade', 'wager', 'settlement']
  if (/\bcommit yes\b|\bauthorized:\s*commit\b/i.test(text)) authority.commit = true
  if (/\bpush yes\b|\bauthorized:\s*push\b/i.test(text)) authority.push = true
  if (/\bauthorized:\s*production\b/i.test(text)) authority.production_deploy = true
  if (intelligenceClass === 'SOCIAL_CHECKIN' || intelligenceClass === 'SYSTEM_STATUS' || intelligenceClass === 'DEEP_RESEARCH' || intelligenceClass === 'DECISION_SUPPORT') {
    authority.local_repair = false
  }
  const level: AuthorityLevel = authority.commit || authority.push || authority.production_deploy
    ? 'COMMANDER_APPROVAL_REQUIRED'
    : intelligenceClass === 'ENGINEERING_MISSION'
      ? 'LOCAL_REPAIR'
      : 'READ_ONLY'
  return { level, authority, approvals }
}

function objectiveFrom(text: string, intelligenceClass: IntelligenceMissionClass): string {
  const trimmed = text.trim()
  if (!trimmed) return 'Unspecified. Unknown until Commander clarifies.'
  if (trimmed.length <= 280) return trimmed
  if (intelligenceClass === 'SYSTEM_STATUS') return 'Report live War Room runtime status from telemetry.'
  return trimmed.slice(0, 280)
}

export function createMissionContract(input: {
  missionId: string
  ebcClass: EbcMissionClass
  intelligenceClass: IntelligenceMissionClass
  commanderMessage: string
  requiredTools?: readonly string[]
  now?: string
  lightweight?: boolean
}): MissionContractV1 {
  const now = input.now ?? new Date().toISOString()
  const text = input.commanderMessage.trim()
  const exclusions = extractExclusions(text)
  const requirements = extractRequirements(text)
  const { level, authority, approvals } = authorityFromText(text, input.intelligenceClass)
  const light = input.lightweight === true || input.intelligenceClass === 'SOCIAL_CHECKIN'
  const known: string[] = []
  const unknown: string[] = []
  const assumptions: string[] = []
  if (!text) unknown.push('Commander objective not provided')
  if (input.intelligenceClass === 'SYSTEM_STATUS') unknown.push('Live PIDs and install identity until telemetry returns')
  if (input.intelligenceClass === 'DEEP_RESEARCH') unknown.push('Primary-source content until Browser Broker returns evidence')
  if (/\bwithout changing the system\b/i.test(text)) known.push('Commander forbids system mutation for this mission')
  if (exclusions.includes('commit')) known.push('Commit is excluded')
  if (!requirements.length && !light) assumptions.push('No additional unspoken requirements were invented')

  const scope = light
    ? [input.intelligenceClass === 'SOCIAL_CHECKIN' ? 'Council presence' : 'Runtime status']
    : unique([
      input.intelligenceClass === 'ENGINEERING_MISSION' ? 'Council/runtime engineering' : 'Council intelligence mission',
      ...exclusions.map(item => `exclude:${item}`),
    ])

  return Object.freeze({
    schema: MISSION_CONTRACT_SCHEMA,
    mission_id: input.missionId,
    mission_class: input.intelligenceClass,
    ebc_mission_class: input.ebcClass,
    version: 1,
    objective: objectiveFrom(text, input.intelligenceClass),
    scope,
    explicit_requirements: requirements,
    explicit_exclusions: exclusions,
    constraints: unique([
      ...exclusions.map(item => `${item} forbidden unless Commander authorizes`),
      'Commander remains authority source',
      'EBC remains evidence truth spine',
    ]),
    known_facts: known,
    unknowns: unknown,
    assumptions,
    required_evidence: input.intelligenceClass === 'SYSTEM_STATUS' || input.intelligenceClass === 'ENGINEERING_MISSION'
      ? ['install_id', '3847_pid', '3848_pid']
      : input.intelligenceClass === 'DEEP_RESEARCH'
        ? ['primary_external']
        : [],
    required_tools: [...(input.requiredTools ?? [])],
    risk_level: input.intelligenceClass === 'RISK_REVIEW' || input.intelligenceClass === 'INCIDENT_RESPONSE' ? 'HIGH'
      : input.intelligenceClass === 'SOCIAL_CHECKIN' ? 'LOW'
        : 'MED',
    authority_level: level,
    approval_requirements: approvals,
    completion_criteria: light
      ? ['Answer Commander from allowed layers only']
      : unique([
        'Mission Contract recorded',
        ...requirements,
        'Unauthorized actions remain blocked',
      ]),
    success_conditions: ['Commander question answered within authority', 'Evidence not invented'],
    failure_conditions: ['Silent authority bypass', 'Speculation promoted to VERIFIED', 'Secret stored in receipts'],
    temporal_requirements: ['Current-state claims must carry observation time'],
    privacy_requirements: ['Do not store secrets in contracts, receipts, or memory'],
    estimated_complexity: complexity(text, input.intelligenceClass),
    authority,
    commander_wording: text,
    created_at: now,
    updated_at: now,
    revisions: [],
    lightweight: light,
  })
}

export function amendMissionContract(contract: MissionContractV1, input: {
  reason: string
  changes: Partial<Pick<MissionContractV1, 'objective' | 'scope' | 'explicit_requirements' | 'explicit_exclusions' | 'constraints' | 'authority'>>
  executionStarted: boolean
  now?: string
}): { contract: MissionContractV1; revision_receipt_required: boolean } {
  const now = input.now ?? new Date().toISOString()
  const changed = Object.keys(input.changes)
  const revision: MissionContractRevision = {
    revision: contract.version + 1,
    amended_at: now,
    reason: input.reason,
    changed_fields: changed,
    receipt_id: input.executionStarted ? `rev-${contract.mission_id}-${contract.version + 1}` : null,
  }
  const next: MissionContractV1 = {
    ...contract,
    ...input.changes,
    version: contract.version + 1,
    updated_at: now,
    revisions: [...contract.revisions, revision],
  }
  return { contract: Object.freeze(next), revision_receipt_required: input.executionStarted }
}
