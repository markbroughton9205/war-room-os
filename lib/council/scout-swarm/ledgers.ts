import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { PrivateSeatLedger, ScoutLedgerEntry, ScoutPlan } from './types'
import { isCurrentRoundIdentity } from './governor'

export function createPrivateSeatLedger(plan: ScoutPlan): PrivateSeatLedger {
  return {
    agentId: plan.agentId,
    seatId: plan.seatId,
    missionId: plan.missionId,
    roundRequestId: plan.roundRequestId,
    logicalRequestId: plan.logicalRequestId,
    entries: [],
    evidence: [],
  }
}

export function appendLedgerEvidence(
  ledger: PrivateSeatLedger,
  scout: ScoutPlan,
  evidence: IntelligenceEvidenceItem[],
  current: { missionId: string; roundRequestId: string; logicalRequestId: string },
): { ledger: PrivateSeatLedger; discarded: boolean } {
  if (!isCurrentRoundIdentity(current, {
    missionId: scout.missionId,
    roundRequestId: scout.roundRequestId,
    logicalRequestId: scout.logicalRequestId,
  })) {
    return { ledger, discarded: true }
  }
  const entries: ScoutLedgerEntry[] = evidence.map(item => ({
    evidenceId: item.id,
    scoutId: scout.scoutId,
    scoutType: scout.scoutType,
    seatId: scout.seatId,
    agentId: scout.agentId,
    missionId: scout.missionId,
    roundRequestId: scout.roundRequestId,
    logicalRequestId: scout.logicalRequestId,
    query: scout.query,
    region: scout.region,
  }))
  const known = new Set(ledger.evidence.map(item => item.id))
  const unique = evidence.filter(item => !known.has(item.id))
  return {
    discarded: false,
    ledger: {
      ...ledger,
      entries: [...ledger.entries, ...entries],
      evidence: [...ledger.evidence, ...unique],
    },
  }
}

export function ledgerEvidenceIds(ledger: PrivateSeatLedger): string[] {
  return [...new Set(ledger.evidence.map(item => item.id))]
}

export function formatPrivateEvidenceBlock(ledger: PrivateSeatLedger): string {
  if (!ledger.evidence.length) {
    return `${ledger.agentId.toUpperCase()}_PRIVATE_LEDGER: empty. Label factual assertions as model judgment or unresolved.`
  }
  return [
    `${ledger.agentId.toUpperCase()}_PRIVATE_LEDGER:`,
    ...ledger.evidence.slice(0, 12).map(item => {
      const origin = item.origin_type ?? 'unlabeled'
      return `- ${item.id} [${origin}/${item.freshness}] ${item.source_label}: ${item.title}${item.url ? ` (${item.url})` : ''}`
    }),
  ].join('\n')
}
