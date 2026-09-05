'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CognitiveBusEvent, CognitiveBusEventType } from '@/lib/cognitive-bus/types'
import { bridgeCognitiveBusEvent } from '@/lib/ui/runtimeEventBridge'

type BusEventRow = {
  id: string
  type: CognitiveBusEventType | string
  at: string
  payload: Record<string, unknown>
}

type BusSnapshot = {
  ok: boolean
  events?: BusEventRow[]
  orchestrationSummary?: {
    phase: string
    consensusState: string | null
    openContradictions: string[]
    commanderApprovalRequired: boolean
  }
  state?: {
    operatorPacket?: {
      status: string
      synthesis_summary: string
      consensus_state: string
    } | null
  }
}

const EVENT_LABEL: Record<string, string> = {
  signal_received: 'Signal intake',
  provider_packet: 'Provider packet',
  contradiction_raised: 'Contradiction',
  challenge: 'Red Team challenge',
  synthesis_step: 'Synthesis',
  delegation: 'Delegation',
  escalation: 'Escalation',
  routing: 'Routing',
  operator_packet: 'Operator packet',
}

function formatEventSummary(event: BusEventRow): string {
  const payload = event.payload ?? {}
  switch (event.type) {
    case 'routing':
      return `${String(payload.from ?? '?')} → ${String(payload.to ?? '?')}: ${String(payload.reason ?? '').slice(0, 120)}`
    case 'contradiction_raised':
      return String(payload.summary ?? 'Families disagree — CONFLICTED.')
    case 'provider_packet': {
      const packet = payload.packet as { family?: string; confidence?: number } | undefined
      return packet?.family
        ? `${packet.family} packet (confidence ${Math.round((packet.confidence ?? 0.5) * 100)}%)`
        : 'Structured provider packet'
    }
    case 'synthesis_step':
      return `Packets: ${String(payload.packetCount ?? 0)} · consensus ${String(payload.consensusState ?? 'unknown')}`
    case 'operator_packet': {
      const packet = payload.packet as { synthesis_summary?: string } | undefined
      return packet?.synthesis_summary?.slice(0, 160) ?? 'Operator packet PROPOSED'
    }
    case 'delegation':
      return `Delegated to ${String(payload.family ?? '?')} (priority ${String(payload.priority ?? '—')})`
    case 'challenge':
      return `Challenge: ${String(payload.challenger ?? 'red_team')} → ${String(payload.target ?? 'council')}`
    default:
      return typeof payload.decreePreview === 'string'
        ? payload.decreePreview.slice(0, 160)
        : EVENT_LABEL[event.type] ?? event.type
  }
}

/**
 * Normalize a polled bus row into the CognitiveBusEvent shape the Matrix bridge resolves:
 * provider_packet / operator_packet rows nest their structured packet under `payload.packet`,
 * while resolveCognitiveBusEvent reads integrity_status / confidence / status at the top level.
 */
function toBridgeableBusEvent(row: BusEventRow): CognitiveBusEvent {
  const payload: Record<string, unknown> = { ...(row.payload ?? {}) }
  const nested = payload.packet as Record<string, unknown> | undefined
  if (nested) {
    if (row.type === 'provider_packet') {
      payload.integrity_status ??= nested.integrity_status
      payload.confidence ??= nested.confidence
    }
    if (row.type === 'operator_packet') payload.status ??= nested.status
  }
  return { id: row.id, threadId: '', type: row.type as CognitiveBusEventType, at: row.at, payload }
}

export function CouncilDeliberationStream(props: { threadId: string | null; enabled?: boolean }) {
  const { threadId, enabled = true } = props
  const [snapshot, setSnapshot] = useState<BusSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridgedEventIdsRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!threadId || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/council/bus?threadId=${encodeURIComponent(threadId)}`, { cache: 'no-store' })
      const data = (await res.json()) as BusSnapshot
      if (!res.ok || !data.ok) {
        setError('Council deliberation stream unavailable.')
        return
      }
      setSnapshot(data)
      // Matrix runtime bridge: emit each newly-applied CognitiveBusEvent exactly once.
      for (const row of data.events ?? []) {
        if (bridgedEventIdsRef.current.has(row.id)) continue
        bridgedEventIdsRef.current.add(row.id)
        bridgeCognitiveBusEvent(toBridgeableBusEvent(row))
      }
    } catch {
      setError('Council deliberation stream unavailable.')
    } finally {
      setLoading(false)
    }
  }, [threadId, enabled])

  useEffect(() => {
    if (!threadId || !enabled) return undefined
    const run = () => void refresh()
    const initial = window.setTimeout(run, 0)
    const timer = window.setInterval(run, 12_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh, threadId, enabled])

  const events = useMemo(() => (snapshot?.events ?? []).slice(-24), [snapshot?.events])
  const summary = snapshot?.orchestrationSummary
  const operatorPacket = snapshot?.state?.operatorPacket

  if (!enabled || !threadId) return null

  return (
    <div
      className="mt-3 rounded border border-cyan-900/40 px-3 py-2"
      style={{ background: 'rgba(0,0,0,0.32)' }}
      data-testid="council-deliberation-stream"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] font-bold tracking-widest" style={{ color: '#67E8F9' }}>
          COUNCIL DELIBERATION
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded px-2 py-0.5 text-[8px] font-bold tracking-widest"
          style={{ border: '1px solid #155E75', color: '#67E8F9' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {summary ? (
        <p className="mb-2 text-[9px] tracking-wide" style={{ color: '#94a3b8' }}>
          Phase: {summary.phase}
          {summary.consensusState ? ` · ${summary.consensusState}` : ''}
          {summary.openContradictions.length ? ` · conflicts: ${summary.openContradictions.join(', ')}` : ''}
          {summary.commanderApprovalRequired ? ' · Commander approval required' : ''}
        </p>
      ) : null}
      {operatorPacket ? (
        <p className="mb-2 text-[9px] tracking-wide" style={{ color: '#FDE68A' }}>
          Operator packet ({operatorPacket.status}): {operatorPacket.synthesis_summary.slice(0, 200)}
        </p>
      ) : null}
      {error ? (
        <p className="text-[9px] tracking-wide" style={{ color: '#f87171' }}>{error}</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[9px] tracking-wide" style={{ color: '#a8a29e' }}>
          {events.length === 0 ? (
            <li>No deliberation events yet — bus activates as families respond.</li>
          ) : (
            events.map(event => (
              <li key={event.id} className="rounded border border-cyan-950/50 px-2 py-1">
                <span className="font-bold" style={{ color: '#67E8F9' }}>
                  {EVENT_LABEL[event.type] ?? event.type}
                </span>
                <span className="ml-2 opacity-70">{new Date(event.at).toLocaleTimeString()}</span>
                <div className="mt-0.5">{formatEventSummary(event)}</div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}