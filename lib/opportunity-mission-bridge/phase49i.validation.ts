import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CommanderReadinessCard, ReadinessState } from '@/lib/opportunity-readiness/types'
import { READINESS_STATES, assessOpportunityReadiness } from '@/lib/opportunity-readiness/index'
import { runOpportunityReadinessValidation } from '@/lib/opportunity-readiness/validation'
import type { IncomeLootConsoleOpportunity } from '@/lib/income-loot/consoleViewModel'
import { buildIncomeLootConsoleViewModel } from '@/lib/income-loot/consoleViewModel'
import { insertIncomeLootOpportunity, __resetIncomeLootStore } from '@/lib/income-loot/store'
import { recordCashReceivedReward, __resetIncomeLootRewardLedger } from '@/lib/income-loot/rewardLedger'
import type { LootOpportunity, RewardLedgerProvenance } from '@/lib/income-loot/types'

import { deriveMissionStatusFromReadiness, applyMissionAction } from './bridgeEngine'
import { buildCommanderFieldBrief } from './fieldBrief'
import { fromIncomeLootOpportunity } from './adapter'
import { validateOpportunityId, validateReportBackInput } from './validation'
import {
  ensureMissionRecord,
  getMissionRecord,
  listMissionRecordsForOwner,
  syncMissionAssessment,
  markMissionCommanderActive,
  submitMissionReportBack,
  checkLedgerVerifiedPayment,
  closeMission,
  MISSION_BRIDGE_STORE_CAP,
  __resetMissionBridgeStore,
} from './reportBack'
import { CLOSABLE_MISSION_STATUSES, type MissionStatus, type ReportBackInput } from './types'

export type Phase49iValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): Phase49iValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

const BRIDGE_SOURCE_FILES = [
  'lib/opportunity-mission-bridge/types.ts',
  'lib/opportunity-mission-bridge/bridgeEngine.ts',
  'lib/opportunity-mission-bridge/fieldBrief.ts',
  'lib/opportunity-mission-bridge/adapter.ts',
  'lib/opportunity-mission-bridge/validation.ts',
  'lib/opportunity-mission-bridge/reportBack.ts',
  'lib/opportunity-mission-bridge/index.ts',
  'app/api/opportunity-mission-bridge/route.ts',
]

function lootOpportunity(overrides: Partial<LootOpportunity> = {}): Omit<LootOpportunity, 'id' | 'discoveredAt' | 'updatedAt' | 'commanderApprovalRequired'> {
  return {
    ownerUserId: 'owner-1',
    provider: 'Acme Surveys',
    providerOpportunityId: 'ext-1',
    title: 'Paid product survey',
    description: 'A short paid survey.',
    category: 'SURVEY',
    estimatedReward: { amount: 12, currency: 'USD', basis: 'ESTIMATED', notes: '' },
    estimatedTimeMinutes: 30,
    expiresAt: null,
    eligibility: ['Must be 18+'],
    locationRequirement: null,
    evidenceRequirement: ['Screenshot of completion'],
    externalUrl: 'https://example.com/survey',
    status: 'DISCOVERED',
    evidenceLabel: 'LIVE_SIGNAL_BACKED',
    confidence: 0.8,
    provenance: [{ sourceAdapterId: 'test-adapter', sourceType: 'web_search', sourceUrl: null, retrievedAt: new Date().toISOString(), searchQuery: null, providerRecordId: null, freshness: 'current', isHistorical: false }],
    ...overrides,
  }
}

function consoleItem(overrides: Partial<IncomeLootConsoleOpportunity> = {}): IncomeLootConsoleOpportunity {
  const model = buildIncomeLootConsoleViewModel({ dataAvailable: true, opportunities: [{ ...lootOpportunity(), id: 'loot-fixture-1', discoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), commanderApprovalRequired: true, ownerUserId: 'owner-1' }], evidence: [] })
  return { ...model.opportunities[0], ...overrides }
}

function baseCard(overrides: Partial<CommanderReadinessCard> = {}): CommanderReadinessCard {
  const input = fromIncomeLootOpportunity(consoleItem())
  const card = assessOpportunityReadiness({ opportunity: { ...input, requirements: [], requirementsResearched: true } })
  return { ...card, ...overrides }
}

function manualProvenance(actorId: string): RewardLedgerProvenance {
  return { sourceAdapterId: 'test', sourceType: 'commander_manual', providerRecordId: null, sourceUrl: null, retrievedAt: new Date().toISOString(), actorId, notes: null }
}

/** Creates a fresh Income Loot opportunity, walks it through readiness ->
 * commander-active -> report-back with the given received-payment claim
 * (or null for "no claim reported"), and returns the opportunity id. Used
 * by the payment-correlation adversarial tests below. */
function setupMissionWithClaim(ownerUserId: string, claim: { amount: number; currency: string } | null): string {
  const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId }) })
  if (!stored) throw new Error('fixture opportunity failed to insert')
  ensureMissionRecord(ownerUserId, stored.id)
  syncMissionAssessment(ownerUserId, stored.id, 'READY_NOW', false)
  markMissionCommanderActive(ownerUserId, stored.id)
  submitMissionReportBack(ownerUserId, {
    opportunityId: stored.id,
    outcome: 'COMPLETED',
    providerResponse: null,
    timeSpentMinutes: null,
    travelCost: null,
    otherCosts: null,
    compensationPromised: null,
    compensationReceivedClaim: claim ? { amount: claim.amount, currency: claim.currency, basis: 'UNKNOWN', per: 'per_task' } : null,
    paymentStatus: claim ? 'COMMANDER_REPORTED_RECEIVED_UNVERIFIED' : 'NOT_YET_PAID',
    evidenceRefs: [],
    commanderNotes: null,
  })
  return stored.id
}

export function runPhase49iValidation(): Phase49iValidationResult[] {
  const results: Phase49iValidationResult[] = []
  const add = (id: string, fn: () => boolean | string) => results.push(test(id, fn))

  __resetMissionBridgeStore()
  __resetIncomeLootStore()
  __resetIncomeLootRewardLedger()

  // 1-3: bridge reuses existing identity and engine, no second source of truth
  add('bridge-uses-existing-opportunity-id', () => {
    const item = consoleItem({ id: 'earn-now-42' })
    const normalized = fromIncomeLootOpportunity(item)
    return normalized.id === item.id || `expected id passthrough, got ${normalized.id}`
  })
  add('no-duplicate-opportunity-source-of-truth', () => {
    const item = consoleItem({ id: 'earn-now-43', title: 'Field survey', externalUrl: 'https://example.com/x' })
    const normalized = fromIncomeLootOpportunity(item)
    return (normalized.title === item.title && normalized.sourceUrl === item.externalUrl) || 'adapter did not faithfully mirror source opportunity fields'
  })
  add('readiness-api-reused', () => {
    const item = consoleItem()
    const normalized = fromIncomeLootOpportunity(item)
    const card = assessOpportunityReadiness({ opportunity: normalized })
    return (typeof card.readinessState === 'string' && READINESS_STATES.includes(card.readinessState)) || 'adapter output was not accepted by the existing readiness engine'
  })

  // 4: initial state
  add('not-assessed-initial-state', () => {
    __resetMissionBridgeStore()
    const record = ensureMissionRecord('owner-1', 'opp-fresh-1')
    return record.missionStatus === 'NOT_ASSESSED' || `expected NOT_ASSESSED, got ${record.missionStatus}`
  })

  // 5-6: unknown/hard-blocked eligibility
  add('unknown-eligibility-not-ready', () => {
    const status = deriveMissionStatusFromReadiness({ readinessState: 'ELIGIBILITY_UNCONFIRMED', hasPreparationPath: false })
    return status === 'NOT_READY' || `expected NOT_READY, got ${status}`
  })
  add('hard-blocker-prevents-ready', () => {
    const status = deriveMissionStatusFromReadiness({ readinessState: 'NOT_CURRENTLY_ELIGIBLE', hasPreparationPath: false })
    return status === 'BLOCKED' || `expected BLOCKED, got ${status}`
  })

  // 7-10: field brief gating
  add('ready-now-permits-field-brief', () => {
    const card = baseCard({ readinessState: 'READY_NOW', fieldBriefFacts: { whereToGo: 'Remote', when: null, whatToBring: [], whatToExpect: 'x', whatToAsk: [], expectedIncome: { value: 10, currency: 'USD', basis: 'ESTIMATED', notes: null }, expectedTime: { value: 1, basis: 'ESTIMATED', notes: null }, successCheckpoint: 'done' } })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.available === 'FULL_FIELD_BRIEF' && result.brief !== null) || `expected FULL_FIELD_BRIEF, got ${result.available}`
  })
  add('ready-with-prep-yields-prep-brief', () => {
    const card = baseCard({ readinessState: 'READY_WITH_PREP' })
    const result = buildCommanderFieldBrief('opp-1', card)
    return result.available === 'PREPARATION_BRIEF' || `expected PREPARATION_BRIEF, got ${result.available}`
  })
  add('blocked-prevents-field-execution-brief', () => {
    const card = baseCard({ readinessState: 'BLOCKED' })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.available === 'NOT_AVAILABLE' && result.brief === null) || `expected NOT_AVAILABLE, got ${result.available}`
  })
  add('not-currently-eligible-prevents-field-execution-brief', () => {
    const card = baseCard({ readinessState: 'NOT_CURRENTLY_ELIGIBLE' })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.available === 'NOT_AVAILABLE' && result.brief === null) || `expected NOT_AVAILABLE, got ${result.available}`
  })

  // 11-12: question preservation
  add('commander-questions-preserved', () => {
    const questions: CommanderReadinessCard['commanderQuestions'] = [{ id: 'q1', requirementId: 'r1', question: 'Do you have X?', whyItMatters: 'because', resolvesRequirement: 'r1', resolvesRequirementIds: ['r1'], possibleReadinessStateChange: 'READY_NOW' }]
    const card = baseCard({ readinessState: 'READY_NOW', commanderQuestions: questions, fieldBriefFacts: { whereToGo: null, when: null, whatToBring: [], whatToExpect: 'x', whatToAsk: [], expectedIncome: { value: null, currency: 'USD', basis: 'UNKNOWN', notes: null }, expectedTime: { value: null, basis: 'UNKNOWN', notes: null }, successCheckpoint: 'x' } })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.brief?.commanderQuestions.length === 1 && result.brief.commanderQuestions[0].id === 'q1') || 'commanderQuestions were not preserved into the field brief'
  })
  add('provider-questions-preserved', () => {
    const questions: CommanderReadinessCard['providerQuestions'] = [{ id: 'pq1', question: 'What is the pay rate?', fieldMissing: 'compensation' }]
    const card = baseCard({ readinessState: 'READY_NOW', providerQuestions: questions, fieldBriefFacts: { whereToGo: null, when: null, whatToBring: [], whatToExpect: 'x', whatToAsk: [], expectedIncome: { value: null, currency: 'USD', basis: 'UNKNOWN', notes: null }, expectedTime: { value: null, basis: 'UNKNOWN', notes: null }, successCheckpoint: 'x' } })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.brief?.providerQuestions.length === 1 && result.brief.providerQuestions[0].id === 'pq1') || 'providerQuestions were not preserved into the field brief'
  })

  // 13-16: no fabrication in adapter
  add('unsupported-location-stays-unknown', () => {
    const normalized = fromIncomeLootOpportunity(consoleItem({ locationRequirement: null }))
    return normalized.location === null || 'location was fabricated when unsupported'
  })
  add('unsupported-modality-stays-unknown', () => {
    const normalized = fromIncomeLootOpportunity(consoleItem())
    return normalized.workMode === 'unknown' || 'workMode was inferred rather than left unknown'
  })
  add('compensation-basis-preserved', () => {
    const normalized = fromIncomeLootOpportunity(consoleItem({ estimatedReward: { amount: 15, currency: 'USD', basis: 'ESTIMATED', notes: '' } }))
    return normalized.compensation.basis === 'ESTIMATED' || `expected ESTIMATED, got ${normalized.compensation.basis}`
  })
  add('unknown-compensation-not-fabricated', () => {
    const normalized = fromIncomeLootOpportunity(consoleItem({ estimatedReward: null }))
    return (normalized.compensation.amount === null && normalized.compensation.basis === 'UNKNOWN') || 'compensation was fabricated when unknown'
  })

  // 17-18: promised vs received vs verified
  add('expected-pay-not-equal-received-pay', () => {
    __resetMissionBridgeStore()
    ensureMissionRecord('owner-2', 'opp-pay-1')
    syncMissionAssessment('owner-2', 'opp-pay-1', 'READY_NOW', false)
    markMissionCommanderActive('owner-2', 'opp-pay-1')
    const input: ReportBackInput = { opportunityId: 'opp-pay-1', outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: 30, travelCost: null, otherCosts: null, compensationPromised: { amount: 20, currency: 'USD', basis: 'ESTIMATED', per: 'per_task' }, compensationReceivedClaim: { amount: 15, currency: 'USD', basis: 'UNKNOWN', per: 'per_task' }, paymentStatus: 'COMMANDER_REPORTED_RECEIVED_UNVERIFIED', evidenceRefs: [], commanderNotes: null }
    const outcome = submitMissionReportBack('owner-2', input)
    if (!outcome.ok) return `submit failed: ${outcome.reason}`
    const promised = outcome.record.reportBack?.compensationPromised?.amount
    const received = outcome.record.reportBack?.compensationReceivedClaim?.amount
    return (promised === 20 && received === 15) || 'promised and received compensation were conflated'
  })
  add('received-pay-not-equal-verified-pay', () => {
    const record = getMissionRecord('owner-2', 'opp-pay-1')
    return (record?.missionStatus === 'PAYMENT_PENDING' && record.ledgerVerifiedAt === null) || `commander-claimed receipt was treated as verified: ${record?.missionStatus}`
  })

  // 19-21: ledger verification
  add('verified-deposit-can-close-payment-loop', () => {
    __resetIncomeLootStore()
    __resetIncomeLootRewardLedger()
    __resetMissionBridgeStore()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-3' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    ensureMissionRecord('owner-3', stored.id)
    syncMissionAssessment('owner-3', stored.id, 'READY_NOW', false)
    markMissionCommanderActive('owner-3', stored.id)
    // A matching compensationReceivedClaim is now required to correlate
    // against ledger evidence — see checkLedgerVerifiedPayment.
    submitMissionReportBack('owner-3', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: 10, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: { amount: 12, currency: 'USD', basis: 'UNKNOWN', per: 'per_task' }, paymentStatus: 'COMMANDER_REPORTED_RECEIVED_UNVERIFIED', evidenceRefs: [], commanderNotes: null })
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-3', opportunityId: stored.id, amount: 12, currency: 'USD', provenance: { sourceAdapterId: 'test', sourceType: 'commander_manual', providerRecordId: null, sourceUrl: null, retrievedAt: new Date().toISOString(), actorId: 'owner-3', notes: null }, receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-3', stored.id)
    return (outcome.ok && outcome.record.missionStatus === 'PAYMENT_VERIFIED') || `expected PAYMENT_VERIFIED, got ${outcome.ok ? outcome.record.missionStatus : outcome.reason}`
  })
  add('pending-payment-remains-pending-without-ledger-evidence', () => {
    __resetIncomeLootStore()
    __resetIncomeLootRewardLedger()
    __resetMissionBridgeStore()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-4' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    ensureMissionRecord('owner-4', stored.id)
    syncMissionAssessment('owner-4', stored.id, 'READY_NOW', false)
    markMissionCommanderActive('owner-4', stored.id)
    submitMissionReportBack('owner-4', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: 10, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: null, paymentStatus: 'PROMISED', evidenceRefs: [], commanderNotes: null })
    const outcome = checkLedgerVerifiedPayment('owner-4', stored.id)
    const record = getMissionRecord('owner-4', stored.id)
    return (!outcome.ok && record?.missionStatus === 'PAYMENT_PENDING') || 'payment was verified without ledger evidence'
  })
  add('zero-amount-cash-receipt-handled', () => {
    __resetIncomeLootStore()
    __resetIncomeLootRewardLedger()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-5' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    const result = recordCashReceivedReward({ ownerUserId: 'owner-5', opportunityId: stored.id, amount: 0, currency: 'USD', provenance: { sourceAdapterId: 'test', sourceType: 'commander_manual', providerRecordId: null, sourceUrl: null, retrievedAt: new Date().toISOString(), actorId: 'owner-5', notes: null }, receipt: { receivedAt: new Date().toISOString(), method: null } })
    return result.code === 'RECORDED' || `zero-amount receipt was rejected unexpectedly: ${result.code}`
  })

  // 22-25: report-back outcomes
  add('report-back-supports-not-attended', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'DID_NOT_ATTEND', paymentStatus: 'NOT_APPLICABLE' })
    return parsed.ok || `rejected: ${!parsed.ok ? parsed.reason : ''}`
  })
  add('report-back-supports-attended-not-completed', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'ATTENDED_NOT_COMPLETED', paymentStatus: 'NOT_APPLICABLE' })
    return parsed.ok || `rejected: ${!parsed.ok ? parsed.reason : ''}`
  })
  add('report-back-supports-completed', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE' })
    return parsed.ok || `rejected: ${!parsed.ok ? parsed.reason : ''}`
  })
  add('commander-notes-optional', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE' })
    return (parsed.ok && parsed.value.commanderNotes === null) || 'commanderNotes was not optional'
  })

  // 26: costs distinct from compensation
  add('costs-remain-distinct-from-compensation', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE', travelCost: 5, otherCosts: 3, compensationPromised: { amount: 20, currency: 'USD', basis: 'ESTIMATED', per: 'per_task' } })
    return (parsed.ok && parsed.value.travelCost === 5 && parsed.value.otherCosts === 3 && parsed.value.compensationPromised?.amount === 20) || 'costs and compensation were conflated or lost'
  })

  // 27: time bounds
  add('time-spent-bounded-and-validated', () => {
    const tooLarge = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE', timeSpentMinutes: 999999 })
    const negative = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE', timeSpentMinutes: -5 })
    return (!tooLarge.ok && !negative.ok) || 'an out-of-bounds timeSpentMinutes value was accepted'
  })

  // 28: duplicate report-back rejected
  add('duplicate-report-back-rejected', () => {
    __resetIncomeLootStore()
    __resetMissionBridgeStore()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-6' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    ensureMissionRecord('owner-6', stored.id)
    syncMissionAssessment('owner-6', stored.id, 'READY_NOW', false)
    markMissionCommanderActive('owner-6', stored.id)
    const first = submitMissionReportBack('owner-6', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: null, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: null, paymentStatus: 'NOT_APPLICABLE', evidenceRefs: [], commanderNotes: null })
    const second = submitMissionReportBack('owner-6', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: null, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: null, paymentStatus: 'NOT_APPLICABLE', evidenceRefs: [], commanderNotes: null })
    return (first.ok && !second.ok) || 'a second report-back for the same mission state was not rejected'
  })

  // 29-30: oversized / malformed input
  add('oversized-input-rejected', () => {
    const parsed = validateReportBackInput({ opportunityId: 'x', outcome: 'COMPLETED', paymentStatus: 'NOT_APPLICABLE', providerResponse: 'a'.repeat(5000) })
    return !parsed.ok || 'an oversized providerResponse was accepted'
  })
  add('malformed-input-fails-closed', () => {
    const nullBody = validateReportBackInput(null)
    const badId = validateOpportunityId(12345)
    return (!nullBody.ok && !badId.ok) || 'malformed input was not rejected'
  })

  // 31-32: auth-first ordering (structural — no fake session harness available)
  add('unauthorized-api-rejected', () => {
    const routeSource = source('app/api/opportunity-mission-bridge/route.ts')
    const hasGuard = /requireCommanderSession/.test(routeSource) && /if\s*\(!commander\.ok\)\s*return commander\.response/.test(routeSource)
    return hasGuard || 'route does not guard every handler with requireCommanderSession'
  })
  add('auth-runs-before-body-or-store-access', () => {
    const routeSource = source('app/api/opportunity-mission-bridge/route.ts')
    const postBody = routeSource.slice(routeSource.indexOf('export async function POST'))
    const authIndex = postBody.indexOf('requireCommanderSession')
    const jsonIndex = postBody.indexOf('req.json()')
    return (authIndex >= 0 && jsonIndex > authIndex) || 'auth does not run before body parsing in POST'
  })

  // 33-37: no side-channel actions
  add('no-external-fetch', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      if (/\bfetch\s*\(/.test(text)) return `${file} calls fetch()`
    }
    return true
  })
  add('no-arbitrary-url-execution', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      if (/https?:\/\//.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) return `${file} embeds a literal external URL`
    }
    return true
  })
  add('no-paypal-mutation', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      if (/confirmBankDeposit|trackPayPalReceipt|updatePayPalAutoTransferState|reconcilePayPalIncoming|createPayPalIncomeAdapter/.test(text)) return `${file} references a PayPal mutation`
    }
    return true
  })
  add('no-income-loot-operation-mutation', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      if (/prepareParticipantApplication|updateParticipantApplicationStatus|insertIncomeLootOpportunity|updateIncomeLootOpportunity|enqueueParticipantQuestion|decideExpenseReport|generateExpenseReport/.test(text)) return `${file} references an Income Loot mutation`
    }
    return true
  })
  add('no-email-or-message-send', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      if (/twilio|sendMessage|sendEmail|nodemailer/i.test(text)) return `${file} references a messaging integration`
    }
    return true
  })

  // 38: no durable memory write
  add('no-durable-memory-write', () => {
    for (const file of BRIDGE_SOURCE_FILES) {
      const text = source(file)
      // Strip comments first so an honest doc comment that *disclaims*
      // Supabase usage (e.g. "never written to Supabase") doesn't
      // false-positive — this checks for actual usage, not the word.
      const stripped = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      if (/from\s+['"][^'"]*supabase[^'"]*['"]/i.test(stripped)) return `${file} imports a Supabase client module`
      if (/createSupabaseServerClient\s*\(/.test(stripped)) return `${file} calls createSupabaseServerClient(`
      if (/from\s+['"][^'"]*durableStore[^'"]*['"]/i.test(stripped) || /durableStore\s*\.\s*\w+\s*\(/.test(stripped)) return `${file} references durableStore`
      if (/\bsupabase\s*\.\s*\w+/i.test(stripped)) return `${file} references a supabase client property/method`
    }
    const record = ensureMissionRecord('owner-7', 'opp-durable-check')
    return (record.durableMemoryWritten === false && record.persistence === 'session_only') || 'MissionRecord did not mark itself session-only'
  })

  // 39-40: bounded store + eviction
  add('session-store-bounded', () => {
    return MISSION_BRIDGE_STORE_CAP === 500 || `expected cap of 500, got ${MISSION_BRIDGE_STORE_CAP}`
  })
  add('session-store-eviction-works', () => {
    __resetMissionBridgeStore()
    for (let i = 0; i < MISSION_BRIDGE_STORE_CAP + 5; i += 1) ensureMissionRecord('owner-evict', `opp-evict-${i}`)
    const all = listMissionRecordsForOwner('owner-evict')
    const oldestStillPresent = getMissionRecord('owner-evict', 'opp-evict-0')
    return (all.length <= MISSION_BRIDGE_STORE_CAP && oldestStillPresent === null) || 'store exceeded its cap or failed to evict the oldest entry'
  })

  // 41: no persisted Commander facts
  add('commander-facts-remain-session-scoped', () => {
    __resetMissionBridgeStore()
    const record = ensureMissionRecord('owner-8', 'opp-facts-1')
    return !('commanderFacts' in record) || 'MissionRecord unexpectedly persists commanderFacts'
  })

  // 42-44: no automatic advancement
  add('sync-never-auto-marks-active', () => {
    __resetMissionBridgeStore()
    const outcome = syncMissionAssessment('owner-9', 'opp-auto-1', 'READY_NOW', false)
    return (outcome.ok && outcome.record.missionStatus === 'READY_FOR_COMMANDER_ACTION') || 'READY_NOW assessment did not stop at READY_FOR_COMMANDER_ACTION'
  })
  add('sync-never-auto-marks-complete', () => {
    const forbidden: MissionStatus[] = ['COMMANDER_ACTIVE', 'OUTCOME_REPORTED', 'REPORT_BACK_DUE']
    for (const state of READINESS_STATES as readonly ReadinessState[]) {
      const status = deriveMissionStatusFromReadiness({ readinessState: state, hasPreparationPath: true })
      if (forbidden.includes(status)) return `readinessState ${state} illegally derived ${status}`
    }
    return true
  })
  add('sync-never-auto-marks-paid', () => {
    for (const state of READINESS_STATES as readonly ReadinessState[]) {
      const status = deriveMissionStatusFromReadiness({ readinessState: state, hasPreparationPath: true })
      if (status === 'PAYMENT_VERIFIED' || status === 'PAYMENT_PENDING') return `readinessState ${state} illegally derived ${status}`
    }
    return true
  })

  // 45-46: evidence ref preservation
  add('field-brief-evidence-refs-preserved', () => {
    const card = baseCard({ readinessState: 'READY_NOW', evidenceSourceReferences: ['source: https://example.com/a'], fieldBriefFacts: { whereToGo: null, when: null, whatToBring: [], whatToExpect: 'x', whatToAsk: [], expectedIncome: { value: null, currency: 'USD', basis: 'UNKNOWN', notes: null }, expectedTime: { value: null, basis: 'UNKNOWN', notes: null }, successCheckpoint: 'x' } })
    const result = buildCommanderFieldBrief('opp-1', card)
    return (result.brief?.evidenceRefs.length === 1 && result.brief.evidenceRefs[0] === 'source: https://example.com/a') || 'evidenceRefs were not preserved into the field brief'
  })
  add('report-back-evidence-refs-preserved', () => {
    __resetIncomeLootStore()
    __resetMissionBridgeStore()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-10' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    ensureMissionRecord('owner-10', stored.id)
    syncMissionAssessment('owner-10', stored.id, 'READY_NOW', false)
    markMissionCommanderActive('owner-10', stored.id)
    const outcome = submitMissionReportBack('owner-10', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: null, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: null, paymentStatus: 'NOT_APPLICABLE', evidenceRefs: ['evidence-1', 'evidence-2'], commanderNotes: null })
    return (outcome.ok && outcome.record.reportBack?.evidenceRefs.length === 2) || 'report-back evidenceRefs were not preserved'
  })

  // 47-48: protected-surface regressions
  add('phase49g-protected-logic-preserved', () => {
    const model = buildIncomeLootConsoleViewModel({ dataAvailable: true, opportunities: [{ ...lootOpportunity({ ownerUserId: 'owner-11' }), id: 'loot-49g-1', discoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString(), commanderApprovalRequired: true }], evidence: [] })
    return Array.isArray(model.earnNow) || 'Phase 49-G consoleViewModel earnNow computation regressed'
  })
  add('phase49h-protected-logic-preserved', () => {
    __resetIncomeLootStore()
    __resetIncomeLootRewardLedger()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-12' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    const result = recordCashReceivedReward({ ownerUserId: 'owner-12', opportunityId: stored.id, amount: 5, currency: 'USD', provenance: { sourceAdapterId: 'test', sourceType: 'commander_manual', providerRecordId: null, sourceUrl: null, retrievedAt: new Date().toISOString(), actorId: 'owner-12', notes: null }, receipt: { receivedAt: new Date().toISOString(), method: null } })
    return result.code === 'RECORDED' || 'Phase 49-H reward ledger regressed'
  })

  // 49: Phase 49-D suite still passes
  add('phase49d-validation-still-passes', () => {
    const phase49dResults = runOpportunityReadinessValidation()
    const failed = phase49dResults.filter(r => !r.pass)
    return failed.length === 0 || `${failed.length} Phase 49-D tests regressed: ${failed.map(f => f.id).join(', ')}`
  })

  // 50: external action count zero across every artifact this suite produced
  add('external-action-count-zero', () => {
    __resetIncomeLootStore()
    __resetMissionBridgeStore()
    const stored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-13' }) })
    if (!stored) return 'fixture opportunity failed to insert'
    const record = ensureMissionRecord('owner-13', stored.id)
    const sync = syncMissionAssessment('owner-13', stored.id, 'READY_NOW', false)
    const active = markMissionCommanderActive('owner-13', stored.id)
    const report = submitMissionReportBack('owner-13', { opportunityId: stored.id, outcome: 'COMPLETED', providerResponse: null, timeSpentMinutes: null, travelCost: null, otherCosts: null, compensationPromised: null, compensationReceivedClaim: null, paymentStatus: 'NOT_APPLICABLE', evidenceRefs: [], commanderNotes: null })
    const flags = [record.externalActionsExecuted, sync.ok ? sync.record.externalActionsExecuted : true, active.ok ? active.record.externalActionsExecuted : true, report.ok ? report.record.externalActionsExecuted : true, report.ok ? (report.record.reportBack?.externalActionsExecuted ?? true) : true]
    const violations = flags.filter(f => f !== false).length
    return violations === 0 || `${violations} produced artifacts claimed an external action was executed`
  })

  // 51-55: CLOSE-gating correction (independent-review Finding #1) — a
  // narrow allow-list, not "anything except CLOSED"
  add('close-rejected-from-not-assessed', () => {
    const result = applyMissionAction('NOT_ASSESSED', { type: 'COMMANDER_CLOSE' })
    return !result.ok || 'NOT_ASSESSED -> CLOSED was illegally accepted'
  })
  add('close-rejected-from-assessing', () => {
    const result = applyMissionAction('ASSESSING', { type: 'COMMANDER_CLOSE' })
    return !result.ok || 'ASSESSING -> CLOSED was illegally accepted'
  })
  add('close-rejected-from-commander-active', () => {
    const result = applyMissionAction('COMMANDER_ACTIVE', { type: 'COMMANDER_CLOSE' })
    return !result.ok || 'COMMANDER_ACTIVE -> CLOSED was illegally accepted'
  })
  add('close-accepted-from-every-closable-state', () => {
    for (const status of CLOSABLE_MISSION_STATUSES) {
      const result = applyMissionAction(status, { type: 'COMMANDER_CLOSE' })
      if (!result.ok || result.status !== 'CLOSED') return `expected CLOSED from ${status}, got ${result.ok ? result.status : result.reason}`
    }
    return true
  })
  add('close-rejected-does-not-mutate-store', () => {
    __resetMissionBridgeStore()
    const before = ensureMissionRecord('owner-close-1', 'opp-close-1') // NOT_ASSESSED — not closable
    const outcome = closeMission('owner-close-1', 'opp-close-1')
    const after = getMissionRecord('owner-close-1', 'opp-close-1')
    if (outcome.ok) return 'expected close from NOT_ASSESSED to be rejected'
    return (after?.missionStatus === before.missionStatus && after?.updatedAt === before.updatedAt) || 'a rejected close mutated the stored mission record'
  })

  // 56-65: verified-payment correlation correction (independent-review
  // Finding #2) — a ledger entry must not verify a mission merely by
  // sharing an opportunity id; amount + currency must correlate.
  add('payment-claim-500-verified-1-not-verified', () => {
    const oppId = setupMissionWithClaim('owner-pay-1', { amount: 500, currency: 'USD' })
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-1', opportunityId: oppId, amount: 1, currency: 'USD', provenance: manualProvenance('owner-pay-1'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-1', oppId)
    return !outcome.ok || 'a $1 ledger entry incorrectly verified a $500 claim'
  })
  add('payment-claim-500-verified-499-not-verified', () => {
    const oppId = setupMissionWithClaim('owner-pay-2', { amount: 500, currency: 'USD' })
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-2', opportunityId: oppId, amount: 499, currency: 'USD', provenance: manualProvenance('owner-pay-2'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-2', oppId)
    return !outcome.ok || 'a $499 ledger entry incorrectly verified a $500 claim'
  })
  add('payment-claim-500-verified-500-correct-opportunity-currency-verifies', () => {
    const oppId = setupMissionWithClaim('owner-pay-3', { amount: 500, currency: 'USD' })
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-3', opportunityId: oppId, amount: 500, currency: 'USD', provenance: manualProvenance('owner-pay-3'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-3', oppId)
    return (outcome.ok && outcome.record.missionStatus === 'PAYMENT_VERIFIED') || `expected PAYMENT_VERIFIED for a matching $500/$500 USD claim, got ${outcome.ok ? outcome.record.missionStatus : outcome.reason}`
  })
  add('payment-correct-amount-wrong-opportunity-not-verified', () => {
    const claimedOppId = setupMissionWithClaim('owner-pay-4', { amount: 500, currency: 'USD' })
    const otherStored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-pay-4', providerOpportunityId: 'ext-other' }) })
    if (!otherStored) return 'second fixture opportunity failed to insert'
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-4', opportunityId: otherStored.id, amount: 500, currency: 'USD', provenance: manualProvenance('owner-pay-4'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-4', claimedOppId)
    return !outcome.ok || 'a $500 deposit against a different opportunity incorrectly verified this mission'
  })
  add('payment-correct-amount-wrong-currency-not-verified', () => {
    const oppId = setupMissionWithClaim('owner-pay-5', { amount: 500, currency: 'USD' })
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-5', opportunityId: oppId, amount: 500, currency: 'EUR', provenance: manualProvenance('owner-pay-5'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-5', oppId)
    return !outcome.ok || 'a EUR 500 deposit incorrectly verified a USD 500 claim'
  })
  add('payment-unrelated-deposit-not-verified', () => {
    // Same amount, same owner, but a DIFFERENT opportunity — the classic
    // "unrelated later deposit" attack the ledger-entry-existence-only
    // check used to be vulnerable to.
    const claimedOppId = setupMissionWithClaim('owner-pay-6', { amount: 250, currency: 'USD' })
    const unrelatedStored = insertIncomeLootOpportunity({ ...lootOpportunity({ ownerUserId: 'owner-pay-6', providerOpportunityId: 'ext-unrelated' }) })
    if (!unrelatedStored) return 'unrelated fixture opportunity failed to insert'
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-6', opportunityId: unrelatedStored.id, amount: 250, currency: 'USD', provenance: manualProvenance('owner-pay-6'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-6', claimedOppId)
    return !outcome.ok || 'an unrelated deposit against a different opportunity incorrectly verified this mission'
  })
  add('payment-no-claimed-amount-not-auto-verified', () => {
    const oppId = setupMissionWithClaim('owner-pay-7', null)
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-7', opportunityId: oppId, amount: 75, currency: 'USD', provenance: manualProvenance('owner-pay-7'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `ledger record failed: ${ledgerResult.code}`
    const outcome = checkLedgerVerifiedPayment('owner-pay-7', oppId)
    return (!outcome.ok && /Commander-reported received amount/.test(outcome.reason)) || 'a generic CASH_RECEIVED entry auto-verified a mission with no Commander-reported claim to correlate against'
  })
  add('payment-multiple-deposits-aggregate-when-matching-currency', () => {
    const oppId = setupMissionWithClaim('owner-pay-8', { amount: 500, currency: 'USD' })
    const first = recordCashReceivedReward({ ownerUserId: 'owner-pay-8', opportunityId: oppId, amount: 300, currency: 'USD', provenance: manualProvenance('owner-pay-8'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    const second = recordCashReceivedReward({ ownerUserId: 'owner-pay-8', opportunityId: oppId, amount: 200, currency: 'USD', provenance: manualProvenance('owner-pay-8'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    // A third, different-currency entry must NOT be pulled into the sum.
    const unrelatedCurrency = recordCashReceivedReward({ ownerUserId: 'owner-pay-8', opportunityId: oppId, amount: 1000, currency: 'EUR', provenance: manualProvenance('owner-pay-8'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (first.code !== 'RECORDED' || second.code !== 'RECORDED' || unrelatedCurrency.code !== 'RECORDED') return 'fixture ledger entries failed to record'
    const outcome = checkLedgerVerifiedPayment('owner-pay-8', oppId)
    return (outcome.ok && outcome.record.missionStatus === 'PAYMENT_VERIFIED') || `expected two same-currency CASH_RECEIVED entries ($300+$200) to sum and verify a $500 claim, got ${outcome.ok ? outcome.record.missionStatus : outcome.reason}`
  })
  add('payment-zero-dollar-handled-truthfully', () => {
    const oppId = setupMissionWithClaim('owner-pay-9', { amount: 0, currency: 'USD' })
    const noEvidenceOutcome = checkLedgerVerifiedPayment('owner-pay-9', oppId)
    if (noEvidenceOutcome.ok) return 'a $0 claim with no ledger entry at all was incorrectly verified'
    const ledgerResult = recordCashReceivedReward({ ownerUserId: 'owner-pay-9', opportunityId: oppId, amount: 0, currency: 'USD', provenance: manualProvenance('owner-pay-9'), receipt: { receivedAt: new Date().toISOString(), method: 'paypal' } })
    if (ledgerResult.code !== 'RECORDED') return `zero-amount ledger record failed: ${ledgerResult.code}`
    const withEvidenceOutcome = checkLedgerVerifiedPayment('owner-pay-9', oppId)
    return (withEvidenceOutcome.ok && withEvidenceOutcome.record.missionStatus === 'PAYMENT_VERIFIED') || 'a $0 claim matching a real $0 CASH_RECEIVED entry was not verified'
  })
  add('payment-commander-claim-alone-never-verified', () => {
    const oppId = setupMissionWithClaim('owner-pay-10', { amount: 500, currency: 'USD' })
    // No recordCashReceivedReward call, no checkLedgerVerifiedPayment call —
    // the self-report alone must never advance the mission status.
    const record = getMissionRecord('owner-pay-10', oppId)
    return (record?.missionStatus === 'PAYMENT_PENDING' && record.ledgerVerifiedAt === null) || `a Commander self-claim alone advanced the mission to ${record?.missionStatus} without ledger verification`
  })

  // 66-68: cross-owner isolation (independent-review session-store finding)
  add('cross-owner-read-denied', () => {
    __resetMissionBridgeStore()
    ensureMissionRecord('owner-victim-1', 'opp-shared-1')
    const attackerView = getMissionRecord('owner-attacker-1', 'opp-shared-1')
    return attackerView === null || 'owner-attacker-1 was able to read owner-victim-1 mission record'
  })
  add('cross-owner-mutation-denied', () => {
    __resetMissionBridgeStore()
    ensureMissionRecord('owner-victim-2', 'opp-shared-2')
    syncMissionAssessment('owner-victim-2', 'opp-shared-2', 'READY_NOW', false)
    const attackerAttempt = markMissionCommanderActive('owner-attacker-2', 'opp-shared-2')
    const victimRecord = getMissionRecord('owner-victim-2', 'opp-shared-2')
    return (!attackerAttempt.ok && victimRecord?.missionStatus === 'READY_FOR_COMMANDER_ACTION') || 'owner-attacker-2 was able to mutate or interfere with owner-victim-2 mission record'
  })
  add('guessed-opportunity-id-does-not-bypass-ownership', () => {
    __resetMissionBridgeStore()
    ensureMissionRecord('owner-victim-3', 'opp-guessable-id-12345')
    const guessed = getMissionRecord('owner-attacker-3', 'opp-guessable-id-12345')
    const listed = listMissionRecordsForOwner('owner-attacker-3')
    return (guessed === null && listed.length === 0) || 'a guessed opportunityId under a different ownerUserId exposed another owner\'s mission record'
  })

  return results
}
