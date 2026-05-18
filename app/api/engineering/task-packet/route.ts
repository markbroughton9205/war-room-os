import { NextResponse } from 'next/server'

import { listCommanderSnapshot } from '@/lib/commander'
import { createEngineeringTaskPacketFromSources } from '@/lib/engineering/engineeringTaskPacket'
import { listFeatureBuilderSnapshot } from '@/lib/feature-builder/persistence'
import { getOutcomeLedgerSnapshot } from '@/lib/learning/outcomeLedger'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { listPersistedSignalSnapshot } from '@/lib/signals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [features, revenue, signals, commander] = await Promise.all([
    listFeatureBuilderSnapshot(8),
    listRevenueEngineSnapshot(16),
    listPersistedSignalSnapshot(16),
    listCommanderSnapshot(16),
  ])
  const outcomes = getOutcomeLedgerSnapshot()

  const approvedFeature = features.packets.find(packet => packet.approvalStatus === 'approved')
  const revenueMove = revenue.highestLeverageMove
  const strongestSignal = signals.strongestSignal
  const commanderMove = commander.highestLeverageMove
  const outcomeCorrection = outcomes.summary.unresolvedRiskCount > 0
    ? `${outcomes.summary.unresolvedRiskCount} unresolved outcome risk(s) need reality correction.`
    : 'Outcome ledger has no unresolved correction above threshold.'
  const redTeamWarning = commander.realityCorrectionAlerts.find(alert => alert.redTeamBabyWarning)

  const sourceParts = [
    approvedFeature ? `Feature Builder approved packet: ${approvedFeature.title}` : 'Feature Builder: no approved packet available',
    revenueMove ? `Revenue Engine move: ${revenueMove.title}` : 'Revenue Engine: no highest leverage move available',
    strongestSignal ? `Signal Radar strongest signal: ${strongestSignal.title}` : 'Signal Radar: no source-backed strongest signal available',
    `Outcome Ledger: ${outcomeCorrection}`,
    redTeamWarning ? `Red Team warning: ${redTeamWarning.title}` : 'Red Team: no active repair warning',
    commanderMove ? `Commander OS move: ${commanderMove.title}` : 'Commander OS: no leverage move available',
  ]

  const packet = createEngineeringTaskPacketFromSources({
    title: approvedFeature?.title
      ? `Cursor repair/build packet: ${approvedFeature.title}`
      : strongestSignal?.title
        ? `Cursor investigation packet: ${strongestSignal.title}`
        : 'Cursor task packet: repair highest leverage War Room gap',
    objective: [
      approvedFeature?.objective,
      revenueMove?.nextManualAction,
      strongestSignal?.recommendedNextAction,
      commanderMove?.nextManualAction,
    ].filter(Boolean).join(' ') || 'Prepare a manual Cursor repair packet from current War Room evidence.',
    currentIssue: sourceParts.join(' | '),
    packetSource: sourceParts.join(' ; '),
    filesToInspect: [
      ...(approvedFeature?.requiredFilesToInspect ?? []),
      'app/(dashboard)/war-room/page.tsx',
      'app/page.tsx',
      'components/war-room',
      'lib/providers/health.ts',
      'lib/signals',
      'lib/revenue-engine',
      'lib/commander',
    ],
    riskNotes: [
      redTeamWarning?.summary ?? 'No current Red Team repair warning is persisted.',
      signals.persistenceNote,
      revenue.persistenceNote,
      commander.persistenceNote,
      'No task packet authorizes shell execution, file mutation, deployment, spend, outreach, or hidden action from War Room.',
    ],
    validationChecklist: [
      'Provider and Baby statuses must come from sanitized server status, not key presence.',
      'Signal rows must be source-backed; missing schema must report MIGRATION_REQUIRED.',
      'Engineering output remains copy-only and requires Commander approval before manual Cursor work.',
      'Run pnpm exec tsc --noEmit, pnpm exec eslint app components lib --max-warnings=0, and pnpm run build.',
    ],
    commitMessage: 'fix(war-room): repair provider binding signals orchestration and baby observer',
  })

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    packet,
    diagnostics: {
      packetSource: packet.packetSource,
      featureBuilderSource: approvedFeature ? 'approved_packet' : 'none',
      revenueSource: revenueMove ? 'highest_leverage_move' : 'none',
      signalSource: strongestSignal ? 'strongest_signal' : signals.persistenceNote.includes('MIGRATION_REQUIRED') ? 'migration_required' : 'none',
      outcomeSource: outcomes.summary.unresolvedRiskCount > 0 ? 'reality_correction' : 'no_unresolved_correction',
      redTeamSource: redTeamWarning ? 'repair_warning' : 'none',
      commanderSource: commanderMove ? 'highest_leverage_move' : 'none',
      canExecute: false,
      cursorInvoked: false,
    },
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-war-room-engineering-packet': 'manual-copy-only',
    },
  })
}
