import 'server-only'

import { getRepairSnapshot } from '@/lib/council-repair'
import { collectRepairIntelligence } from '@/lib/evolution/repairIntelligence'
import type { SweepFinding } from '../types'

export async function collectCouncilFindings(req: Request): Promise<SweepFinding[]> {
  const findings: SweepFinding[] = []
  const repair = getRepairSnapshot()
  const intelligence = await collectRepairIntelligence(req)

  if (repair.latestPacket?.recommendedFix?.some((plan: string) => /^(prepare|generate|create)\s+(a\s+)?repair/i.test(plan.trim()))) {
    findings.push({
      id: 'sweep:council:generic-repair-packet',
      title: 'Latest council repair packet uses generic fix-plan language',
      category: 'council_orchestration',
      severity: 'MEDIUM',
      evidence: ['fixPlan entries look like meta-instructions rather than concrete file/route changes.'],
      affectedFeature: 'Council repair packets',
      affectedPanel: 'Live Council · Repair',
      suggestedAction: 'Regenerate repair packet from OS sweep finding with cursor-ready commands.',
      classification: 'fix',
      repairPacketAvailable: true,
    })
  }

  const queue = intelligence.repairQueue
  if (queue.length > 12) {
    findings.push({
      id: 'sweep:council:repair-queue-depth',
      title: `Repair queue depth ${queue.length} — review for duplicate opportunities`,
      category: 'council_orchestration',
      severity: 'MEDIUM',
      evidence: queue.slice(0, 5).map(item => item.title),
      affectedFeature: 'Repair intelligence',
      affectedPanel: 'War Room Evolution',
      suggestedAction: 'Collapse duplicate queue items; prioritize BLOCKER/HIGH only in operator summary.',
      classification: 'fix',
      repairPacketAvailable: intelligence.nextRequiredAction?.repairPacketAvailable ?? false,
    })
  }

  const weakOpportunities = queue.filter(
    item => /generic|review|unspecified/i.test(item.title) && item.severity !== 'BLOCKER',
  )
  for (const item of weakOpportunities.slice(0, 3)) {
    findings.push({
      id: `sweep:council:weak:${item.id}`,
      title: `Weak opportunity wording: ${item.title}`,
      category: 'council_orchestration',
      severity: 'LOW',
      evidence: item.evidence,
      affectedFeature: 'Council orchestration',
      affectedPanel: item.affectedPanel,
      suggestedAction: 'Replace with source-backed finding from OS sweep or schema sweep.',
      classification: 'fix',
      repairPacketAvailable: item.repairPacketAvailable,
      duplicateOf: 'sweep:council:repair-queue-depth',
    })
  }

  return findings
}
