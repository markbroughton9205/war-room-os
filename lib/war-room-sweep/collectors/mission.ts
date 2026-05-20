import 'server-only'

import { collectQueueSnapshot } from '@/lib/queues'
import { getPaymentProviderReadiness } from '@/lib/payments/providers'
import type { SweepFinding } from '../types'

export async function collectMissionFindings(req: Request): Promise<SweepFinding[]> {
  const findings: SweepFinding[] = []

  let engineering: Awaited<ReturnType<typeof collectQueueSnapshot>> | null = null
  let operator: Awaited<ReturnType<typeof collectQueueSnapshot>> | null = null
  try {
    engineering = await collectQueueSnapshot(req, 'engineering_queue')
    operator = await collectQueueSnapshot(req, 'operator_priority_queue')
  } catch {
    findings.push({
      id: 'sweep:mission:queue-unavailable',
      title: 'Queue snapshot unavailable',
      category: 'mission_revenue',
      severity: 'MEDIUM',
      evidence: ['GET /api/operator/queue or engineering queue failed.'],
      affectedFeature: 'Mission / revenue queues',
      affectedPanel: 'Operator Command Deck',
      suggestedAction: 'Verify queue persistence and /api/engineering/queue.',
      classification: 'fix',
      repairPacketAvailable: false,
    })
    return findings
  }

  const engInOperator = operator?.items.filter(
    item => /engineering|schema|migration|repair packet/i.test(`${item.title} ${item.description ?? ''}`),
  ) ?? []
  if (engInOperator.length) {
    findings.push({
      id: 'sweep:mission:engineering-in-operator-queue',
      title: 'Engineering work visible in operator priority queue',
      category: 'mission_revenue',
      severity: 'MEDIUM',
      evidence: engInOperator.slice(0, 4).map(item => item.title),
      affectedFeature: 'Operator queue hygiene',
      affectedPanel: 'Bottom dock · Operator queue',
      suggestedAction: 'Route engineering items to engineering_queue; keep operator queue revenue/mission focused.',
      classification: 'fix',
      repairPacketAvailable: false,
    })
  }

  const payments = getPaymentProviderReadiness()
  const revenueReady = payments.filter(p => p.status === 'configured').length
  if (revenueReady < 1) {
    findings.push({
      id: 'sweep:mission:no-revenue-ops',
      title: 'No revenue/payment providers configured',
      category: 'mission_revenue',
      severity: 'MEDIUM',
      evidence: payments.map(p => `${p.name}: ${p.status}`),
      affectedFeature: 'Income Operations',
      affectedPanel: 'Income tab / Payments',
      suggestedAction: 'Configure at least one deposit visibility provider (manual proof allowed).',
      classification: 'add',
      repairPacketAvailable: false,
    })
  }

  if ((operator?.items.length ?? 0) < 1 && (engineering?.items.length ?? 0) < 1) {
    findings.push({
      id: 'sweep:mission:weak-queue',
      title: 'Operator and engineering queues are empty',
      category: 'mission_revenue',
      severity: 'INFO',
      evidence: ['No queued missions or engineering tasks in current snapshot.'],
      affectedFeature: 'Mission telemetry',
      affectedPanel: 'Mission Control',
      suggestedAction: 'Confirm queue persistence is connected; empty may be normal if no active missions.',
      classification: 'add',
      repairPacketAvailable: false,
    })
  }

  return findings
}
