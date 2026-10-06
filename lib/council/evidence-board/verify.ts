import {
  type AuroraSynthesisV1,
  type BoardSnapshot,
  type ClaimStatus,
  type CompletionState,
  type EbcClaim,
  type EbcConflict,
  type EbcEvidence,
  type EbcMissionClass,
  type LumenVerification,
  type MissionEvidenceBoard,
  type PhoenixChallenge,
  type PhoenixPassResult,
  type ToolCallRecord,
} from './types'
import { canVerifyFromKinds, evidenceIsFresh, highestEvidenceRank, liveKindsForMission, setClaimStatus } from './board'
import { missionRequiresLiveEvidence } from './assembly'
import { isExternalResearchMission, isUsableExternalEvidence } from './researchTruth'
import { lumenRefuseModelOnlyPromotion } from '@/lib/council/engines/integration/lumen'
import {
  evidenceSupportsClaim,
  independentSourceCount,
  isCircularEvidence,
  isDuplicateSourceSet,
  wordingSimilarityOnly,
} from '@/lib/council/gi/lumenQuality'

const READY_WITHOUT_PROBE = /\bREADY\b/i

export function evidenceKindsForClaim(claim: EbcClaim, evidence: readonly EbcEvidence[]): EbcEvidence[] {
  return evidence.filter(row => claim.evidence_ids.includes(row.evidence_id))
}

export function verifyClaimLumen(input: {
  claim: EbcClaim
  evidence: readonly EbcEvidence[]
  ttlSeconds: number
  missionClass: EbcMissionClass
  rechecked: readonly ToolCallRecord[]
  now?: number
}): LumenVerification {
  const rows = evidenceKindsForClaim(input.claim, input.evidence)
  if (input.claim.evidence_ids.some(id => !input.evidence.some(row => row.evidence_id === id))) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNKNOWN',
      reason: 'fabricated_evidence_id',
      rechecked_evidence_ids: [],
      independent_probe: false,
    }
  }
  if (!rows.length) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNKNOWN',
      reason: 'no_evidence',
      rechecked_evidence_ids: [],
      independent_probe: false,
      evidence_refs: [],
      source_count: 0,
    }
  }
  if (isExternalResearchMission(input.missionClass)) {
    const usable = rows.filter(isUsableExternalEvidence)
    if (!usable.length) {
      return {
        claim_id: input.claim.claim_id,
        verdict: 'UNKNOWN',
        reason: 'no_usable_sources',
        rechecked_evidence_ids: rows.map(row => row.evidence_id),
        independent_probe: false,
        evidence_refs: [],
        source_count: 0,
      }
    }
  }
  const kinds = rows.map(row => row.kind)
  if (kinds.every(kind => kind === 'model_prior')) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'model_prior_cannot_verify',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: false,
    }
  }
  if (kinds.every(kind => kind === 'secondary_external' || kind === 'model_prior' || kind === 'inference')) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'secondary_only_cannot_verify_critical',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: input.rechecked.length > 0,
    }
  }
  const requireLive = missionRequiresLiveEvidence(input.missionClass) && input.claim.critical
  const fresh = rows.some(row => evidenceIsFresh(row, input.ttlSeconds, input.now))
  if (requireLive && !fresh) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNKNOWN',
      reason: 'ttl_exceeded',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: input.rechecked.length > 0,
    }
  }
  if (requireLive && !canVerifyFromKinds(kinds, true, liveKindsForMission(input.missionClass))) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'live_evidence_required',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: input.rechecked.length > 0,
    }
  }
  const recheckFailed = input.rechecked.some(row => row.blocked || !row.ok)
  const recheckOk = input.rechecked.some(row => row.ok)
  if (input.rechecked.length && recheckFailed && !recheckOk) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'CONTRADICTED',
      reason: 'independent_reprobe_failed',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: true,
    }
  }
  if (isCircularEvidence(input.claim, rows)) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNKNOWN',
      reason: 'circular_evidence',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: false,
      circular: true,
    }
  }
  if (wordingSimilarityOnly(input.claim, rows)) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'wording_similarity_is_not_verification',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: false,
      wording_similarity_only: true,
    }
  }
  if (!evidenceSupportsClaim(input.claim, rows)) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'evidence_does_not_support_claim',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: input.rechecked.length > 0,
    }
  }
  const independent = independentSourceCount(rows)
  const duplicate = isDuplicateSourceSet(rows)
  if (input.claim.critical && input.claim.temporal_layer === 'CURRENT_LIVE' && duplicate && rows.length > 1) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'UNSUPPORTED',
      reason: 'duplicate_source_not_independent_corroboration',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: false,
      independent_corroboration: false,
      duplicate_source: true,
    }
  }
  const bindable = isExternalResearchMission(input.missionClass) ? rows.filter(isUsableExternalEvidence) : rows
  if (bindable.length > 0 && bindable.every(row => row.ok) && (recheckOk || !input.rechecked.length)) {
    const usable = bindable
    const refs = usable.map(row => row.evidence_id)
    if (isExternalResearchMission(input.missionClass) && refs.length === 0) {
      return {
        claim_id: input.claim.claim_id,
        verdict: 'UNKNOWN',
        reason: 'no_usable_sources',
        rechecked_evidence_ids: [],
        independent_probe: false,
        evidence_refs: [],
        source_count: 0,
      }
    }
    return {
      claim_id: input.claim.claim_id,
      verdict: 'SUPPORTED',
      reason: 'evidence_supported',
      rechecked_evidence_ids: refs,
      independent_probe: input.rechecked.length > 0 && independent >= 2,
      independent_corroboration: independent >= 2 && !duplicate,
      duplicate_source: duplicate,
      evidence_refs: refs,
      source_count: independentSourceCount(usable),
    }
  }
  if (rows.some(row => !row.ok)) {
    return {
      claim_id: input.claim.claim_id,
      verdict: 'CONTRADICTED',
      reason: 'supporting_tool_failed',
      rechecked_evidence_ids: rows.map(row => row.evidence_id),
      independent_probe: input.rechecked.length > 0,
    }
  }
  return {
    claim_id: input.claim.claim_id,
    verdict: 'UNKNOWN',
    reason: 'insufficient',
    rechecked_evidence_ids: rows.map(row => row.evidence_id),
    independent_probe: input.rechecked.length > 0,
  }
}

export function applyLumenToBoard(board: MissionEvidenceBoard, results: readonly LumenVerification[]): void {
  for (const result of results) {
    if (result.verdict === 'SUPPORTED') setClaimStatus(board, result.claim_id, 'SUPPORTED')
    else if (result.verdict === 'CONTRADICTED') setClaimStatus(board, result.claim_id, 'CONTRADICTED')
    else if (result.verdict === 'UNSUPPORTED' || result.verdict === 'UNKNOWN') {
      const claim = board.claims.find(item => item.claim_id === result.claim_id)
      if (claim && result.reason === 'ttl_exceeded') setClaimStatus(board, result.claim_id, 'STALE')
      else if (claim && result.reason.includes('tool')) setClaimStatus(board, result.claim_id, 'TOOL_BLOCKED')
      else setClaimStatus(board, result.claim_id, 'UNVERIFIED')
    }
  }
}

function thinEvidence(claim: EbcClaim, evidence: readonly EbcEvidence[]): number {
  const rows = evidenceKindsForClaim(claim, evidence)
  if (!rows.length) return 1
  if (rows.every(row => row.kind === 'model_prior' || row.kind === 'inference')) return 1
  if (isDuplicateSourceSet(rows) || rows.length === 1) return 0.7
  return 0.2
}

function reversibilityPenalty(claim: EbcClaim): number {
  if (claim.critical) return 1.2
  return 0.6
}

function strongIndependentEvidence(claim: EbcClaim, evidence: readonly EbcEvidence[]): boolean {
  const rows = evidenceKindsForClaim(claim, evidence).filter(row => row.ok)
  if (rows.length < 2) return false
  if (independentSourceCount(rows) < 2) return false
  return rows.some(row => row.kind === 'live_telemetry' || row.kind === 'tool_result' || row.kind === 'primary_external')
}

export function rankPhoenixTargets(claims: readonly EbcClaim[], evidence: readonly EbcEvidence[]): EbcClaim[] {
  return [...claims].sort((a, b) => {
    const score = (claim: EbcClaim) =>
      (claim.critical ? 1.4 : 0.6) * Math.max(0.1, claim.confidence) * thinEvidence(claim, evidence) * reversibilityPenalty(claim)
    return score(b) - score(a)
  })
}

export function phoenixChallenge(input: {
  board: MissionEvidenceBoard
  pass: number
}): PhoenixPassResult {
  const ranked = rankPhoenixTargets(input.board.claims, input.board.evidence)
    .filter(claim => !strongIndependentEvidence(claim, input.board.evidence))
  const targets = ranked.slice(0, 2)
  const conflicts: EbcConflict[] = []
  const risks: PhoenixPassResult['risks'] = []
  const tests: PhoenixPassResult['tests_recommended'] = []
  const challenges: PhoenixChallenge[] = []
  let rhetoric_only = true

  for (const claim of targets) {
    const rows = evidenceKindsForClaim(claim, input.board.evidence)
    const readyWithoutLive = READY_WITHOUT_PROBE.test(claim.text)
      && (claim.temporal_layer === 'CURRENT_LIVE' || /\bREADY\b/i.test(claim.text))
      && !rows.some(row => (row.kind === 'live_telemetry' || row.kind === 'tool_result') && row.ok)
    if (readyWithoutLive) {
      rhetoric_only = false
      const conflict: EbcConflict = {
        conflict_id: `px-${input.pass}-${claim.claim_id}`,
        claim_ids: [claim.claim_id],
        reason: 'READY claimed without CURRENT_LIVE probe',
        required_test: 'Run wr.core.health / wr.ui.health / wr.council.backend this mission',
        contradicting_evidence_ids: rows.map(row => row.evidence_id),
        open: true,
        agent_id: 'PHOENIX',
        round: input.pass + 1,
      }
      conflicts.push(conflict)
      challenges.push({
        claim_id: claim.claim_id,
        challenge_type: 'OVERCONFIDENCE',
        weakness: 'READY was claimed without a live probe.',
        why_it_matters: 'Commander action must not rest on an unverified live state.',
        evidence_or_test_needed: conflict.required_test,
        resolution_condition: 'A successful live probe this mission, or the READY claim is withdrawn.',
      })
      input.board.conflicts.push({
        ...conflict,
        mission_id: input.board.mission.mission_id,
        timestamp: new Date().toISOString(),
        provenance: 'phoenix',
      })
      setClaimStatus(input.board, claim.claim_id, 'CONTRADICTED')
      tests.push({
        test_id: `test-${conflict.conflict_id}`,
        text: conflict.required_test,
        claim_ids: [claim.claim_id],
        agent_id: 'PHOENIX',
      })
      continue
    }
    if (claim.critical && claim.temporal_layer === 'CURRENT_LIVE' && rows.every(row => row.temporal_layer === 'LAST_VERIFIED' || row.temporal_layer === 'HISTORICAL')) {
      rhetoric_only = false
      const conflict: EbcConflict = {
        conflict_id: `px-temporal-${claim.claim_id}`,
        claim_ids: [claim.claim_id],
        reason: 'LAST_VERIFIED evidence labeled CURRENT_LIVE',
        required_test: 'Re-probe this mission before CURRENT_LIVE labeling',
        contradicting_evidence_ids: rows.map(row => row.evidence_id),
        open: true,
        agent_id: 'PHOENIX',
        round: input.pass + 1,
      }
      conflicts.push(conflict)
      challenges.push({
        claim_id: claim.claim_id,
        challenge_type: 'STALE_EVIDENCE',
        weakness: 'The timestamps are last-verified, not live.',
        why_it_matters: 'Stale evidence can look current and drive a wrong status call.',
        evidence_or_test_needed: conflict.required_test,
        resolution_condition: 'Fresh probe retrieved_at this mission.',
      })
      input.board.conflicts.push({
        ...conflict,
        mission_id: input.board.mission.mission_id,
        timestamp: new Date().toISOString(),
        provenance: 'phoenix',
      })
      setClaimStatus(input.board, claim.claim_id, 'STALE', { temporal_layer: 'LAST_VERIFIED' })
      continue
    }
    if (claim.critical && rows.length === 1 && claim.temporal_layer === 'CURRENT_LIVE') {
      rhetoric_only = false
      challenges.push({
        claim_id: claim.claim_id,
        challenge_type: 'SINGLE_SOURCE',
        weakness: 'One source is carrying a current claim.',
        why_it_matters: 'A single feed can be wrong, mirrored, or stale-labeled.',
        evidence_or_test_needed: 'Independent second probe or primary source.',
        resolution_condition: 'Two independent current sources, or the claim is labeled unverified.',
      })
      tests.push({
        test_id: `single-source-${claim.claim_id}`,
        text: 'Independent second probe or primary source',
        claim_ids: [claim.claim_id],
        agent_id: 'PHOENIX',
      })
      continue
    }
    if (claim.critical && !rows.length) {
      rhetoric_only = false
      risks.push({
        risk_id: `risk-${claim.claim_id}`,
        text: 'Critical claim has no evidence',
        claim_ids: [claim.claim_id],
        agent_id: 'PHOENIX',
      })
      challenges.push({
        claim_id: claim.claim_id,
        challenge_type: 'MISSING_TEST',
        weakness: 'No evidence is attached.',
        why_it_matters: 'Impact is high and the claim is currently free-floating.',
        evidence_or_test_needed: 'Attach live_telemetry or tool_result',
        resolution_condition: 'Evidence row exists or the claim is withdrawn.',
      })
      tests.push({
        test_id: `missing-probe-${claim.claim_id}`,
        text: 'MISSING PROBE: attach live_telemetry or tool_result',
        claim_ids: [claim.claim_id],
        agent_id: 'PHOENIX',
      })
      setClaimStatus(input.board, claim.claim_id, 'UNVERIFIED')
    }
  }

  const successful = conflicts.length > 0 || tests.length > 0 || challenges.length > 0
  return {
    pass: input.pass,
    conflicts,
    risks,
    tests_recommended: tests,
    rhetoric_only: rhetoric_only && !successful,
    successful,
    challenges,
  }
}

export function applyLumenPromotion(board: MissionEvidenceBoard, results: readonly LumenVerification[]): void {
  const open = board.conflicts.some(conflict => conflict.open)
  const research = isExternalResearchMission(board.mission.mission_class)
  for (const result of results) {
    const claim = board.claims.find(item => item.claim_id === result.claim_id)
    if (!claim) continue
    if (result.verdict === 'SUPPORTED' && !open) {
      const rows = evidenceKindsForClaim(claim, board.evidence)
      if (research && !rows.some(isUsableExternalEvidence)) continue
      if (research && !(result.evidence_refs?.length || result.source_count)) continue
      if (research && lumenRefuseModelOnlyPromotion({
        mission_class: board.mission.mission_class,
        claim,
        evidence: board.evidence,
        open_conflicts: open,
      })) continue
      const kinds = rows.map(row => row.kind)
      const requireLive = missionRequiresLiveEvidence(board.mission.mission_class) && claim.critical
      if (canVerifyFromKinds(kinds, requireLive, liveKindsForMission(board.mission.mission_class)) && claim.status === 'SUPPORTED') {
        setClaimStatus(board, claim.claim_id, 'VERIFIED')
      }
    }
  }
}

export function deriveCompletionState(input: {
  policyRefuse?: boolean
  requiredToolsBlocked: boolean
  claims: readonly EbcClaim[]
  conflicts: readonly EbcConflict[]
  budgetExhausted?: boolean
}): CompletionState {
  if (input.policyRefuse) return 'REFUSED'
  const critical = input.claims.filter(claim => claim.critical)
  const usable = input.claims.filter(claim => claim.status === 'VERIFIED' || claim.status === 'SUPPORTED')
  if (input.requiredToolsBlocked && usable.length === 0) return 'TOOL_BLOCKED'
  if (critical.some(claim => claim.status === 'CONTRADICTED') || input.conflicts.some(conflict => conflict.open)) return 'CONTRADICTED'
  if (critical.some(claim => claim.status === 'STALE')) return 'STALE'
  if (critical.length > 0 && critical.every(claim => claim.status === 'VERIFIED') && !input.conflicts.some(conflict => conflict.open)) {
    return 'VERIFIED'
  }
  if (usable.length > 0) return 'PARTIALLY_VERIFIED'
  if (input.budgetExhausted) return 'BUDGET_EXHAUSTED'
  if (input.requiredToolsBlocked || critical.some(claim => claim.status === 'TOOL_BLOCKED')) return 'TOOL_BLOCKED'
  return 'UNVERIFIED'
}

export function deriveConfidence(input: {
  claims: readonly EbcClaim[]
  evidence: readonly EbcEvidence[]
  lumen: readonly LumenVerification[]
  conflicts: readonly EbcConflict[]
}): number {
  const critical = input.claims.filter(claim => claim.critical)
  const verifiedRatio = critical.length ? critical.filter(claim => claim.status === 'VERIFIED').length / critical.length : (input.claims.filter(claim => claim.status === 'VERIFIED').length / Math.max(1, input.claims.length))
  const ranks = input.evidence.map(row => 1 / highestEvidenceRank([row.kind]))
  const rankScore = ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : 0
  const freshRatio = input.evidence.length
    ? input.evidence.filter(row => row.temporal_layer === 'CURRENT_LIVE').length / input.evidence.length
    : 0
  const lumenBoost = input.lumen.length
    ? (input.lumen.filter(row => row.verdict === 'SUPPORTED').length / input.lumen.length) * 0.15
    : 0
  const conflictPenalty = input.conflicts.filter(conflict => conflict.open).length * 0.18
  const stalePenalty = input.claims.filter(claim => claim.status === 'STALE').length * 0.08
  const raw = verifiedRatio * 0.5 + rankScore * 0.2 + freshRatio * 0.15 + lumenBoost - conflictPenalty - stalePenalty
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))))
}

export function synthesizeAurora(snapshot: BoardSnapshot, completion_state: CompletionState, confidence: number): AuroraSynthesisV1 {
  const usableIds = new Set(snapshot.evidence.filter(isUsableExternalEvidence).map(row => row.evidence_id))
  const research = isExternalResearchMission(snapshot.mission_class)
  const claimHasUsable = (claim: { evidence_ids: string[] }) =>
    !research || claim.evidence_ids.some(id => usableIds.has(id))
  const verified_facts = snapshot.claims
    .filter(claim => claim.status === 'VERIFIED' && claimHasUsable(claim))
    .map(claim => ({
      text: claim.text,
      evidence_ids: [...claim.evidence_ids],
      temporal_layer: claim.temporal_layer,
      claim_id: claim.claim_id,
    }))
  const partially_verified = snapshot.claims
    .filter(claim => claim.status === 'SUPPORTED' && claimHasUsable(claim))
    .map(claim => ({ text: claim.text, evidence_ids: [...claim.evidence_ids], claim_id: claim.claim_id }))
  const unverified = snapshot.claims
    .filter(claim => claim.status === 'UNVERIFIED' || claim.status === 'PROPOSED' || claim.status === 'STALE' || claim.status === 'TOOL_BLOCKED')
    .map(claim => ({ text: claim.text, claim_id: claim.claim_id }))
  const unknowns = snapshot.unknowns.map(item => item.text)
  if (!snapshot.claims.length && !snapshot.evidence.length) {
    return {
      mission_class: snapshot.mission_class,
      completion_state,
      confidence: 0,
      verified_facts: [],
      partially_verified: [],
      unverified: [],
      conflicts: snapshot.conflicts.map(conflict => ({ id: conflict.conflict_id, summary: conflict.reason, claim_ids: [...conflict.claim_ids] })),
      unknowns: unknowns.length ? unknowns : ['Board empty — no verified facts'],
      tool_blocks: snapshot.tool_blocks.map(item => item.reason),
      risks: snapshot.risks.map(item => item.text),
      next_actions: [{ action: 'Re-run with live probes', owner: 'Commander' }],
      advisory: true,
      commander_authority: 'REQUIRED_FOR_ACTION',
    }
  }
  return {
    mission_class: snapshot.mission_class,
    completion_state,
    confidence,
    verified_facts,
    partially_verified,
    unverified,
    conflicts: snapshot.conflicts.filter(conflict => conflict.open).map(conflict => ({
      id: conflict.conflict_id,
      summary: conflict.reason,
      claim_ids: [...conflict.claim_ids],
    })),
    unknowns,
    tool_blocks: snapshot.tool_blocks.map(item => `${item.tool_name}: ${item.reason}`),
    risks: snapshot.risks.map(item => item.text),
    next_actions: nextActions(snapshot),
    advisory: true,
    commander_authority: 'REQUIRED_FOR_ACTION',
    degraded: snapshot.tool_blocks.filter(item => /broker/i.test(item.tool_name) || /not configured/i.test(item.reason)).map(item => item.reason),
  }
}

function nextActions(snapshot: BoardSnapshot): Array<{ action: string; owner: string }> {
  const actions: Array<{ action: string; owner: string }> = []
  if (snapshot.tool_blocks.some(item => /broker/i.test(item.tool_name))) {
    actions.push({ action: 'Probe Browser Broker if research capability is required', owner: 'Commander' })
  }
  if (!snapshot.evidence.some(row => /terra/i.test(row.summary))) {
    actions.push({ action: 'Probe Terra live feed only if world-state is required', owner: 'ORION|Commander' })
  }
  if (snapshot.conflicts.some(conflict => conflict.open)) {
    actions.push({ action: 'Resolve open conflicts with new evidence or claim withdrawal', owner: 'Commander' })
  }
  return actions
}

export function revisionAllowed(input: { evidence_delta: boolean; reason: string }): boolean {
  if (!input.evidence_delta) return false
  if (/^(i agree|building on|paraphrase)/i.test(input.reason)) return false
  return true
}

export function refuseFoundryExecution(missionClass: EbcMissionClass, toolName: string): boolean {
  return missionClass === 'ENGINEERING' && /foundry|commit|push|deploy|file\.write|installer/i.test(toolName)
}

export function phoenixContributionSuccessful(envelope: { contradictions: unknown[]; risks: unknown[]; tests_recommended: unknown[]; prose?: string | null }): boolean {
  return envelope.contradictions.length > 0 || envelope.risks.length > 0 || envelope.tests_recommended.length > 0
}

export type GapTask = { owner: 'ORION' | 'PULSAR' | 'NOVA'; objective: string; tools: string[]; reason: string }

export function gapTasksFromReview(lumen: readonly LumenVerification[], phoenix: readonly PhoenixPassResult[]): GapTask[] {
  const tasks: GapTask[] = []
  for (const result of lumen) {
    if (result.verdict === 'UNKNOWN' && result.reason === 'ttl_exceeded') {
      tasks.push({ owner: 'ORION', objective: 'Refresh stale critical probe', tools: ['wr.core.health'], reason: result.reason })
    }
  }
  for (const pass of phoenix) {
    for (const conflict of pass.conflicts) {
      if (/READY claimed without CURRENT_LIVE/.test(conflict.reason)) {
        tasks.push({ owner: 'ORION', objective: conflict.required_test, tools: ['wr.core.health', 'wr.ui.health', 'wr.council.backend'], reason: conflict.reason })
      }
    }
  }
  const seen = new Set<string>()
  return tasks.filter(task => {
    const key = `${task.owner}:${task.tools.join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
