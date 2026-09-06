'use client'

import type { CommanderOperationEvent } from '@/lib/council/unified-experience'

type CouncilOperationEventCardProps = {
  event: CommanderOperationEvent
}

const EVENT_TONE: Record<string, string> = {
  council_mode_selected: '#93C5FD',
  families_assigned: '#93C5FD',
  family_responded: '#86EFAC',
  synthesis_completed: '#86EFAC',
  family_failed: '#FCA5A5',
  family_timed_out: '#FCA5A5',
  operation_failed: '#FCA5A5',
  operation_cancelled: '#FCA5A5',
  operation_completed: '#86EFAC',
  family_unavailable: '#FDE68A',
  family_skipped: '#CBD5E1',
  family_waiting_approval: '#FDE68A',
  approval_required: '#FDE68A',
  lane_assigned: '#93C5FD',
}

function eventLabel(type: string): string {
  if (type === 'family_waiting_prior_turn') return 'Waiting for prior turn'
  if (type === 'system_state_inspected') return 'System state inspected'
  if (type === 'families_assigned') return 'Participants Selected'
  if (type === 'council_mode_selected') return 'Council Round Created'
  if (type === 'request_received') return 'Council Round Created'
  if (type === 'family_queued') return 'Agent Queued'
  if (type === 'family_started') return 'Agent Started'
  if (type === 'family_responded') return 'Agent Responded'
  if (type === 'family_skipped' || type === 'family_unavailable' || type === 'family_failed' || type === 'family_timed_out') return 'Agent Skipped'
  if (type === 'operation_completed') return 'Council Round Completed'
  if (type === 'operation_failed') return 'Council Round Completed · Degraded'
  return type.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function headingFor(event: CommanderOperationEvent): string {
  if (
    event.type === 'families_assigned'
    || event.type === 'council_mode_selected'
    || event.type === 'request_received'
    || event.type === 'operation_completed'
    || event.type === 'operation_failed'
    || event.type === 'operation_cancelled'
  ) {
    return eventLabel(event.type)
  }
  return event.familyLabel ?? eventLabel(event.type)
}

export function CouncilOperationEventCard({ event }: CouncilOperationEventCardProps) {
  const tone = EVENT_TONE[event.type] ?? '#94A3B8'
  const heading = headingFor(event)
  const role = event.roleLabel ?? event.provenance.replaceAll('_', ' ')

  return (
    <li className="relative pl-5">
      <span
        className="absolute left-0 top-3 h-2.5 w-2.5 rounded-full"
        style={{ background: tone, boxShadow: `0 0 12px ${tone}66` }}
        aria-hidden="true"
      />
      <article
        className="min-w-0 rounded px-3 py-2"
        style={{ border: `1px solid ${tone}33`, background: 'rgba(0,0,0,0.24)' }}
      >
        <header className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="break-words text-xs font-bold tracking-widest" style={{ color: tone }}>
            {heading}
          </h4>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            {role}
          </span>
          <span
            className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
            style={{ border: `1px solid ${tone}44`, color: tone }}
          >
            {event.statusLabel}
          </span>
        </header>
        <div className="mt-1 flex flex-wrap gap-2 text-[9px] uppercase tracking-widest" style={{ color: '#64748B' }}>
          <span>{event.provenance.replaceAll('_', ' ')}</span>
          {event.messageId ? <span>Message linked</span> : null}
          {event.isActualProviderOutput ? <span>Actual agent output</span> : <span>No agent output claimed</span>}
        </div>
        {event.replyToLabel ? (
          <p className="mt-2 text-[10px] tracking-widest" style={{ color: '#93C5FD' }}>
            Replying to {event.replyToLabel}
          </p>
        ) : null}
        {event.outputText ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed" style={{ color: '#CBD5E1' }}>
            {event.outputText}
          </p>
        ) : (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: '#64748B' }}>
            No agent message is attached to this operational step.
          </p>
        )}
      </article>
    </li>
  )
}
