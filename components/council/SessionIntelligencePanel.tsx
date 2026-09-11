'use client'

import type { CouncilSessionIntelligenceV1, DurableDeliberationRound } from '@/lib/council/session-intelligence'

function outcomeClass(outcome: string): string {
  if (outcome === 'COMPLETE') return 'text-emerald-300'
  if (outcome === 'DEGRADED') return 'text-amber-300'
  if (outcome === 'FAILED' || outcome === 'INTERRUPTED') return 'text-rose-300'
  return 'text-slate-300'
}

function RoundDetails({ round }: { round: DurableDeliberationRound }) {
  const synthesis = round.synthesisTurnRef
    ? round.turnRefs.find(t => t.turnId === round.synthesisTurnRef)
    : null
  return (
    <div className="mt-2 space-y-1 border-l border-cyan-900/60 pl-2 text-[11px] text-slate-300">
      <p>Roster: {round.roster.map(s => s.toUpperCase()).join(', ') || '—'}</p>
      <p>Providers: {round.providerRuntimeTruth.map(p =>
        `${(p.nebulaId ?? p.seatId).toUpperCase()}→${p.backendType ?? '?'}/${p.providerModel ?? p.providerLabel}`,
      ).join(' · ') || '—'}</p>
      {round.challengeTurnRef ? <p>Challenge: {round.challengeTurnRef}</p> : null}
      {round.revisionTurnRefs.length ? <p>Revisions: {round.revisionTurnRefs.join(', ')}</p> : null}
      {synthesis ? <p>Synthesis: {synthesis.summary ?? synthesis.turnId}</p> : null}
      {round.evidenceRefs.length ? (
        <p>Evidence: {round.evidenceRefs.map(e => e.evidenceId).slice(0, 8).join(', ')}</p>
      ) : null}
      {round.failedSeats.length ? (
        <p className="text-amber-200">Failed seats: {round.failedSeats.join(', ')}</p>
      ) : null}
      {round.degradedReasons.length ? (
        <p className="text-amber-200/90">Degraded: {round.degradedReasons.slice(0, 3).join(' | ')}</p>
      ) : null}
    </div>
  )
}

export function SessionIntelligencePanel({
  intelligence,
}: {
  intelligence: CouncilSessionIntelligenceV1 | null
}) {
  if (!intelligence || intelligence.rounds.length === 0) {
    return (
      <div data-testid="session-intelligence-panel">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Session intelligence</p>
        <p className="text-slate-500">No durable deliberation rounds yet for this conversation.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="session-intelligence-panel">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Session intelligence</p>
        <p className="text-[11px] text-slate-400">
          {intelligence.roundCount} round{intelligence.roundCount === 1 ? '' : 's'} · latest {intelligence.latestRoundId}
        </p>
        {intelligence.sessionDigest.lastSynthesis ? (
          <p className="mt-1 text-[11px] text-slate-300">Digest: {intelligence.sessionDigest.lastSynthesis}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        {intelligence.rounds.map((round, index) => (
          <details key={round.roundId} className="rounded border border-slate-800/80 bg-slate-950/40 px-2 py-1.5" open={index === intelligence.rounds.length - 1}>
            <summary className="cursor-pointer text-[12px]">
              <span className="text-slate-200">Round {index + 1}</span>
              {' — '}
              <span className={outcomeClass(round.outcome)}>{round.outcome}</span>
              <span className="ml-2 text-[10px] text-slate-500">{round.roundId.slice(0, 8)}…</span>
            </summary>
            <RoundDetails round={round} />
          </details>
        ))}
      </div>
    </div>
  )
}
