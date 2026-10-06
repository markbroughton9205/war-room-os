'use client'

import type { EbcPublicSnapshot } from '@/lib/council/evidence-board/types'
import { dedupeList } from '@/lib/council/commander-chat/normalChatContract'
import { councilSourcesFromSnapshot } from '@/lib/council/source-links'
import { CouncilSourceList } from './CouncilSourceList'

export function EvidenceBoardReadout({
  snapshot,
  isUserMessage,
}: {
  snapshot: Partial<EbcPublicSnapshot> | null | undefined
  isUserMessage?: boolean
}) {
  if (!snapshot || isUserMessage) return null
  const aurora = snapshot.aurora
  const unknowns = dedupeList(aurora?.unknowns ?? [])
  const toolBlocks = dedupeList(aurora?.tool_blocks ?? [])
  const verified = dedupeList((aurora?.verified_facts ?? []).map(fact => fact.text))
  const conflicts = aurora?.conflicts ?? []
  const agents = snapshot.selected_agents ?? []
  const toolCalls = snapshot.tool_calls ?? []
  const stateColor =
    snapshot.completion_state === 'VERIFIED' ? '#86EFAC'
    : snapshot.completion_state === 'PARTIALLY_VERIFIED' ? '#FDE68A'
    : snapshot.completion_state === 'CONTRADICTED' || snapshot.completion_state === 'TOOL_BLOCKED' ? '#FCA5A5'
    : '#CBD5E1'
  return (
    <section
      className="mt-2 w-full max-w-2xl rounded px-3 py-2 text-xs"
      style={{ border: '1px solid rgba(134,239,172,0.28)', background: 'rgba(6,24,16,0.35)', color: '#E5E7EB' }}
      data-testid="evidence-board-council"
      aria-label={`Evidence Board Council ${snapshot.completion_state}`}
    >
      <div className="flex flex-wrap items-center gap-2 font-bold tracking-widest">
        <span style={{ color: '#86EFAC' }}>Evidence Board</span>
        <span style={{ color: '#64748B' }}>·</span>
        <span style={{ color: stateColor }}>{snapshot.completion_state}</span>
        <span className="rounded px-2 py-0.5 text-[9px] uppercase" style={{ border: '1px solid rgba(148,163,184,0.35)', color: '#94A3B8' }}>
          {snapshot.mission_class}
        </span>
      </div>
      <div className="mt-2 grid gap-1 font-mono text-[10px]" style={{ color: '#CBD5E1' }}>
        <div>confidence {Math.round((snapshot.confidence ?? 0) * 100)}%</div>
        <div>agents {agents.join(', ') || 'none'}</div>
        <div>evidence {snapshot.evidence_count ?? snapshot.evidence?.length ?? 0} · claims {snapshot.claims_count ?? 0} · tools {toolCalls.length}</div>
        <div>elapsed {snapshot.latency_ms ?? 0}ms</div>
      </div>
      {verified.length ? (
        <div className="mt-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>Verified</div>
          <ul className="mt-1 space-y-0.5">
            {verified.slice(0, 8).map(fact => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {snapshot.sources?.length ? (
        <div className="mt-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#93C5FD' }}>Sources</div>
          <div className="mt-1 font-mono text-[10px]" style={{ color: '#CBD5E1' }}>
            selected {snapshot.selected_source_count ?? snapshot.sources.length} · failed {snapshot.failed_source_count ?? snapshot.sources.filter(row => !row.usable).length} · usable {snapshot.usable_source_count ?? snapshot.sources.filter(row => row.usable).length} · public {snapshot.usable_source_count ?? snapshot.sources.filter(row => row.usable).length}
            {snapshot.research_domain ? ` · domain ${snapshot.research_domain}` : ''}
          </div>
          {snapshot.research_ledger ? (
            <div className="mb-1 font-mono text-[10px]" style={{ color: '#94A3B8' }} data-testid="research-transparency">
              transparency opened {snapshot.research_ledger.opened_source_count} · accepted {snapshot.research_ledger.usable_source_count} · primary {snapshot.research_ledger.primary_source_count} · rejected {snapshot.research_ledger.rejection_history.length} · wave {snapshot.research_ledger.wave_number}
            </div>
          ) : null}
          <CouncilSourceList
            links={councilSourcesFromSnapshot(snapshot)}
            collapsedByDefault={false}
          />
          {(snapshot.evidence ?? []).map(row => (
            <div key={row.id} data-evidence-id={row.id} data-claim-ids={(row.claim_ids ?? []).join(',')} className="sr-only">
              {row.id}
            </div>
          ))}
        </div>
      ) : null}
      {unknowns.length ? (
        <div className="mt-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FDE68A' }}>Unknowns</div>
          <ul className="mt-1 space-y-0.5">
            {unknowns.slice(0, 6).map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      {conflicts.length ? (
        <div className="mt-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FCA5A5' }}>Conflicts</div>
          <ul className="mt-1 space-y-0.5">
            {conflicts.map(conflict => <li key={conflict.id}>{conflict.summary}</li>)}
          </ul>
        </div>
      ) : (
        <div className="mt-2 text-[10px]" style={{ color: '#94A3B8' }}>Conflicts: none</div>
      )}
      {toolBlocks.length ? (
        <div className="mt-2">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FCA5A5' }}>Tool blocks</div>
          <ul className="mt-1 space-y-0.5">
            {toolBlocks.slice(0, 6).map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
