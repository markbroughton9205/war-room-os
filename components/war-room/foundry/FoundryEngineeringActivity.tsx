'use client'

import { useState } from 'react'
import type { FoundryActivityItem } from '@/lib/native-builder/foundryQuietPresentation'

/**
 * Expandable technical activity. Collapsed by default. Every persisted event stays retrievable:
 * each compact row expands to its underlying events, commands, worker attribution, governance, and
 * raw output. Nothing here is a conversation card.
 */

function clock(at: string | null): string {
  if (!at) return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at.slice(11, 19) : date.toLocaleTimeString('en-GB', { hour12: false })
}

function mark(item: FoundryActivityItem): { icon: string; className: string } {
  if (item.status === 'running') return { icon: '…', className: 'text-cyan-300' }
  if (item.status === 'failed') return { icon: '⚠', className: 'text-amber-300' }
  if (item.status === 'info') return { icon: '·', className: 'text-slate-500' }
  return { icon: '✓', className: 'text-emerald-400/80' }
}

function Detail({ item, onOpenFile, onOpenRaw, onStop }: {
  item: FoundryActivityItem
  onOpenFile: (path: string) => void
  onOpenRaw: (ref?: string) => void
  onStop: () => void
}) {
  const t = item.technical
  const rawRef = item.events.find(event => event.rawOutputRef)?.rawOutputRef
  const command = t.commands[t.commands.length - 1]
  return (
    <div className="ml-[10.5rem] space-y-1 pb-2 pr-1 text-[11px] leading-[1.5] text-slate-400" data-testid="foundry-activity-detail">
      {command ? (
        <p className="foundry-q-mono">
          <span className="text-slate-500">command</span> {command.command}
          <span className="text-slate-500"> · exit</span> {command.exitCode ?? '—'}
          {command.durationMs !== null ? <span className="text-slate-500"> · {Math.max(1, Math.round(command.durationMs / 100) / 10)}s</span> : null}
        </p>
      ) : null}
      {t.failureCause ? <p><span className="text-slate-500">failure</span> {t.failureCause}</p> : null}
      {t.hypothesis ? <p><span className="text-slate-500">hypothesis</span> {t.hypothesis}</p> : null}
      {t.repairTarget ? <p><span className="text-slate-500">repair target</span> {t.repairTarget}</p> : null}
      {t.mutationGeneration !== null ? <p><span className="text-slate-500">mutation generation tested</span> {t.mutationGeneration}</p> : null}
      {t.workers.length ? (
        <p><span className="text-slate-500">worker</span> {[...new Set(t.workers.map(w => `${w.provider} / ${w.model} (${w.role.toLowerCase()} · attempt ${w.attempt ?? '—'} · ${w.result ?? '—'})`))].join('; ')}</p>
      ) : null}
      {t.governance.length ? (
        <p><span className="text-slate-500">governance</span> {[...new Set(t.governance.map(g => `${g.commandClass ?? 'n/a'} ${g.allowed === false ? 'denied' : 'allowed'}${g.reason ? ` — ${g.reason}` : ''}`))].join('; ')}</p>
      ) : null}
      {t.files.length ? <p className="foundry-q-mono"><span className="text-slate-500">files</span> {t.files.join(', ')}</p> : null}
      {t.progress.map((view, index) => (
        <p key={`progress-${index}`} className="foundry-q-mono" data-testid="foundry-activity-progress">
          <span className="text-slate-500">{view.kind === 'INVALID_OUTPUT' ? 'invalid output' : 'progress'}</span> {view.baseline ? 'baseline failure recorded' : view.classification}
          {view.signals.length ? ` · ${view.signals.join(', ')}` : ''}
          {view.strategy ? ` · ${view.strategy}` : ''}
          {view.fingerprint ? ` · fingerprint ${view.fingerprint}` : ''}
          <span className="text-slate-500"> · cycle {view.cycles}/{view.cycleLimit} (max {view.absoluteCycles}) · credits {view.credits} · same-failure {view.sameFailureStreak} · same-strategy {view.sameStrategyStreak} · no-progress {view.noStrongProgressStreak}</span>
          {view.stop ? <span className="text-amber-300/80"> · stop {view.stop}</span> : null}
        </p>
      ))}
      {t.outputTail ? <pre className="foundry-q-mono max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10.5px] text-emerald-100/70" data-testid="foundry-activity-output">{t.outputTail}</pre> : null}
      <div className="border-t border-white/5 pt-1" data-testid="foundry-activity-events">
        {item.events.map((event, index) => (
          <p key={event.eventId ?? `${event.type}-${index}`} className="foundry-q-mono truncate text-[10.5px] text-slate-500" title={event.summary}>
            <span suppressHydrationWarning>{clock(event.timestamp ?? null)}</span> {event.type.toLowerCase()} {event.status ? `· ${event.status}` : ''} {event.summary ? `· ${event.summary}` : ''}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[10.5px]">
        {t.files.map(file => (
          <button key={file} type="button" className="text-emerald-300/80 hover:text-emerald-200" onClick={() => onOpenFile(file)}>Open {file}</button>
        ))}
        {command ? (
          <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => void navigator.clipboard?.writeText(command.command)}>Copy command</button>
        ) : null}
        {rawRef || t.outputTail ? (
          <button type="button" data-testid="foundry-open-raw-output" className="text-cyan-300/80 hover:text-cyan-200" onClick={() => onOpenRaw(rawRef)}>Open raw output</button>
        ) : null}
        {item.status === 'running' ? (
          <button type="button" className="text-amber-300/80 hover:text-amber-200" onClick={onStop}>Stop</button>
        ) : null}
      </div>
    </div>
  )
}

export function FoundryEngineeringActivity({
  items,
  onOpenFile,
  onOpenRaw,
  onStop,
  defaultOpen = false,
}: {
  items: FoundryActivityItem[]
  onOpenFile: (path: string) => void
  onOpenRaw: (ref?: string) => void
  onStop: () => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  if (!items.length) return null
  const eventCount = items.reduce((sum, item) => sum + item.events.length, 0)
  return (
    <div data-testid="foundry-engineering-activity" className="text-[11.5px]">
      <button
        type="button"
        data-testid="foundry-activity-toggle"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300"
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true" className="inline-block w-2 text-[9px]">{open ? '▾' : '▸'}</span>
        Activity <span className="text-slate-600">· {items.length} steps · {eventCount} events</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-0" data-testid="foundry-activity-list">
          {items.map(item => {
            const expanded = openIds.has(item.id)
            const m = mark(item)
            return (
              <div key={item.id} data-testid="foundry-activity-row" data-activity-kind={item.kind} data-activity-status={item.status}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[4.2rem_5.2rem_1rem_minmax(0,1fr)] items-baseline gap-x-2 py-[1px] text-left leading-[1.55] foundry-q-mono hover:bg-white/[0.03]"
                  onClick={() => setOpenIds(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}
                >
                  <span className="text-slate-600" suppressHydrationWarning>{clock(item.at)}</span>
                  <span className="truncate text-slate-500">{item.role}</span>
                  <span className={m.className} aria-hidden="true">{m.icon}</span>
                  <span className="truncate text-slate-300">{item.title}</span>
                </button>
                {expanded ? <Detail item={item} onOpenFile={onOpenFile} onOpenRaw={onOpenRaw} onStop={onStop} /> : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
