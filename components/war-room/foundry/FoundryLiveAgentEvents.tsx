'use client'

export type FoundryLiveAgentEventView = {
  eventId: string
  at: string
  type: string
  text: string
  tool?: string | null
  ok?: boolean | null
}

type Props = {
  events?: FoundryLiveAgentEventView[] | null
  missionSelected: boolean
}

export function FoundryLiveAgentEvents({ events, missionSelected }: Props) {
  const rows = missionSelected ? (events ?? []).slice(-12) : []
  return (
    <div
      className="rounded border border-white/10 p-2"
      data-testid="foundry-agent-events"
      role="region"
      aria-label="Live agent events"
    >
      <p className="text-[9px] uppercase tracking-widest text-slate-500">Live agent events</p>
      {!missionSelected ? (
        <p className="mt-1 text-[10px] text-slate-500" data-testid="foundry-agent-events-empty">
          No mission selected. Live agent events appear after you select a mission.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-[10px] text-slate-600" data-testid="foundry-agent-events-empty">
          No streamed events yet.
        </p>
      ) : (
        <ol className="mt-1 max-h-40 space-y-1 overflow-auto" aria-label="Live agent events">
          {rows.map(event => {
            const refused = event.type === 'COMPLETION_REFUSED'
            const name = refused
              ? (event.text.startsWith('Completion refused') ? event.text : `Completion refused: ${event.text}`)
              : [event.type, event.tool, event.text].filter(Boolean).join(' ')
            return (
              <li
                key={event.eventId}
                className="text-[10px] text-slate-300"
                aria-label={name}
                data-event-type={event.type}
              >
                <span className="text-cyan-300">{refused ? 'Completion refused' : event.type}</span>
                {event.tool ? <span className="text-slate-500"> · {event.tool}</span> : null}
                {' '}{refused ? event.text.replace(/^COMPLETION_REFUSED:?\s*/i, '').replace(/^Completion refused:?\s*/i, '') : event.text}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
