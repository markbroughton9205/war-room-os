'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CouncilOperationEventCard } from '@/components/council/CouncilOperationEventCard'
import {
  buildCommanderOperationFromMessage,
  buildCommanderOperationFromMessages,
  buildReadableCommanderOperationCopy,
  type CommanderOperation,
  type CouncilOperationMessageInput,
} from '@/lib/council/unified-experience'

type CopyState = 'idle' | 'copied' | 'failed'

type CouncilOperationTimelineProps = {
  input: CouncilOperationMessageInput
  inputs?: readonly CouncilOperationMessageInput[]
  operation?: CommanderOperation | null
}

function readableStatus(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function useCopyState() {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const copy = useCallback(async (text: string) => {
    clearTimer()
    try {
      if (!text.trim()) throw new Error('Nothing to copy.')
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.')
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    timerRef.current = window.setTimeout(() => {
      setCopyState('idle')
      timerRef.current = null
    }, 2_000)
  }, [clearTimer])

  return { copyState, copy }
}

export function CouncilOperationTimeline({ input, inputs, operation: providedOperation }: CouncilOperationTimelineProps) {
  const operationInputs = useMemo(() => inputs?.length ? inputs : [input], [input, inputs])
  const fallbackOperation = useMemo(
    () => operationInputs.length > 1 ? buildCommanderOperationFromMessages(operationInputs) : buildCommanderOperationFromMessage(input),
    [input, operationInputs],
  )
  const operation = providedOperation ?? fallbackOperation
  const readableCopy = useMemo(() => buildReadableCommanderOperationCopy(operation, operationInputs[0]?.requestText), [operationInputs, operation])
  const rawCopy = useMemo(() => JSON.stringify(operation.technicalData ?? operation, null, 2), [operation])
  const primaryCopy = useCopyState()
  const rawCopyState = useCopyState()
  const primaryLabel =
    primaryCopy.copyState === 'copied'
      ? 'Copied ✓'
      : primaryCopy.copyState === 'failed'
        ? 'Copy failed'
        : 'Copy'
  const rawLabel =
    rawCopyState.copyState === 'copied'
      ? 'Copied ✓'
      : rawCopyState.copyState === 'failed'
        ? 'Copy failed'
        : 'Copy raw JSON'

  return (
    <section
      className="mt-3 w-full max-w-2xl rounded px-3 py-3 text-xs"
      style={{ border: '1px solid rgba(52,211,153,0.18)', background: 'rgba(2,6,23,0.42)' }}
      aria-label="Council operation timeline"
      aria-live={operation.status === 'running' || operation.status === 'waiting_for_provider' || operation.status === 'synthesizing' ? 'polite' : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>
            Council Activity
          </h3>
          <p className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            {operation.summary.title} · {operation.summary.label}
          </p>
          <p className="mt-1 text-[9px] uppercase tracking-widest" style={{ color: '#64748B' }}>
            {operation.timelineSource === 'authoritative_runtime_snapshot'
              ? 'Runtime event record'
              : operation.timelineSource === 'reconciled_runtime_snapshot_and_transcript'
                ? 'Runtime record reconciled with completed response'
                : operation.timelineSource === 'project_packet'
                  ? 'Project operation record'
                  : 'Completed operation record'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-h-8 rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            style={{ border: '1px solid rgba(52,211,153,0.45)', color: primaryCopy.copyState === 'failed' ? '#FCA5A5' : primaryCopy.copyState === 'copied' ? '#86EFAC' : '#A7F3D0' }}
            onClick={() => { void primaryCopy.copy(readableCopy) }}
          >
            {primaryLabel}
          </button>
          <span className="sr-only" aria-live="polite">
            {primaryCopy.copyState === 'copied' ? 'Council briefing copied.' : primaryCopy.copyState === 'failed' ? 'Council briefing copy failed.' : ''}
          </span>
        </div>
      </header>

      <section className="mt-3 rounded px-3 py-2" style={{ border: '1px solid rgba(147,197,253,0.16)', background: 'rgba(0,0,0,0.22)' }}>
        <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#93C5FD' }}>
          Commander Briefing
        </h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed" style={{ color: '#E5E7EB' }}>
          {operation.briefing.body}
        </p>
        {operation.briefing.recommendation ? (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: '#BAE6FD' }}>
            Recommended path: {operation.briefing.recommendation}
          </p>
        ) : null}
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FCA5A5' }}>Open Risks</div>
            <p className="mt-1 text-[11px]" style={{ color: '#CBD5E1' }}>{operation.briefing.risks.join('; ') || 'None reported.'}</p>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#FDE68A' }}>Approval Requirements</div>
            <p className="mt-1 text-[11px]" style={{ color: '#CBD5E1' }}>{operation.briefing.approvalRequirements.join('; ') || 'None reported.'}</p>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#86EFAC' }}>Evidence Status</div>
            <p className="mt-1 whitespace-pre-wrap text-[11px]" style={{ color: '#CBD5E1' }}>{operation.briefing.evidenceStatus}</p>
          </div>
        </div>
        {operation.briefing.nextActions.length ? (
          <div className="mt-2">
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#C4B5FD' }}>Next Actions</div>
            <ul className="mt-1 space-y-1 text-[11px]" style={{ color: '#CBD5E1' }}>
              {operation.briefing.nextActions.map(item => <li key={item}>- {item}</li>)}
            </ul>
          </div>
        ) : null}
      </section>

      {operation.status === 'running' || operation.status === 'waiting_for_provider' || operation.status === 'synthesizing' ? (
        <p className="mt-3 rounded px-3 py-2 text-[10px] uppercase tracking-widest" style={{ border: '1px solid rgba(52,211,153,0.18)', color: '#A7F3D0', background: 'rgba(0,0,0,0.18)' }}>
          Operation running. Waiting for runtime update.
        </p>
      ) : operation.status === 'waiting_approval' ? (
        <p className="mt-3 rounded px-3 py-2 text-[10px] uppercase tracking-widest" style={{ border: '1px solid rgba(253,230,138,0.22)', color: '#FDE68A', background: 'rgba(0,0,0,0.18)' }}>
          Awaiting approval.
        </p>
      ) : null}

      <details className="mt-3 rounded px-3 py-2" style={{ border: '1px solid rgba(52,211,153,0.14)', background: 'rgba(0,0,0,0.18)' }}>
        <summary className="min-h-8 cursor-pointer list-none text-[10px] font-bold uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 [&::-webkit-details-marker]:hidden" style={{ color: '#86EFAC' }}>
          View runtime event timeline
        </summary>
        <ol className="mt-3 space-y-2 border-l border-emerald-400/20 pl-2">
          {operation.events.map(item => (
            <CouncilOperationEventCard key={item.id} event={item} />
          ))}
        </ol>
      </details>

      <details className="mt-3 rounded px-3 py-2" style={{ border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(0,0,0,0.18)' }}>
        <summary className="min-h-8 cursor-pointer list-none text-[10px] font-bold uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-slate-300 [&::-webkit-details-marker]:hidden" style={{ color: '#94A3B8' }}>
          View technical data
        </summary>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: '#64748B' }}>
            Raw JSON is collapsed by default.
          </div>
          <button
            type="button"
            className="min-h-8 rounded px-3 py-1 text-[10px] font-bold uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            style={{ border: '1px solid rgba(148,163,184,0.35)', color: rawCopyState.copyState === 'failed' ? '#FCA5A5' : rawCopyState.copyState === 'copied' ? '#86EFAC' : '#CBD5E1' }}
            onClick={() => { void rawCopyState.copy(rawCopy) }}
          >
            {rawLabel}
          </button>
          <span className="sr-only" aria-live="polite">
            {rawCopyState.copyState === 'copied' ? 'Raw technical data copied.' : rawCopyState.copyState === 'failed' ? 'Raw technical data copy failed.' : ''}
          </span>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[10px]" style={{ color: '#94A3B8' }}>
          {rawCopy}
        </pre>
      </details>

      <p className="mt-2 text-[9px] uppercase tracking-widest" style={{ color: '#64748B' }}>
        {operation.timelineSource === 'authoritative_runtime_snapshot' || operation.timelineSource === 'reconciled_runtime_snapshot_and_transcript'
          ? 'Authoritative runtime-event projection. No provider activity is fabricated.'
          : 'Completed ordered transcript fallback. No provider activity is fabricated.'}
      </p>
      <span className="sr-only">Operation status: {readableStatus(operation.status)}.</span>
    </section>
  )
}
