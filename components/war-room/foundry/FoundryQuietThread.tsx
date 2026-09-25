'use client'

import { useState, type ReactNode } from 'react'
import type { QuietThread } from '@/lib/native-builder/foundryQuietPresentation'
import { FoundryEngineeringActivity } from './FoundryEngineeringActivity'
import { FoundryLiveProgressPanel } from './FoundryLiveProgressPanel'

/**
 * The Commander-facing thread for an engineering mission: ONE progress surface that updates in
 * place, ONE compact completion, and a prominent card only when Commander action is required.
 * Internal workers (Architect / Backend / Test / Debugger / Reviewer / Verifier) live in the
 * collapsed Activity, never as conversation cards. All presentation data comes from
 * foundryQuietPresentation.ts, which derives from (and never replaces) the authoritative events.
 */

function FailureLine({ failure }: { failure: NonNullable<QuietThread['progress']['failure']> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1 pl-3.5" data-testid="foundry-test-failure">
      <button
        type="button"
        data-testid="foundry-view-failure"
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true" className="inline-block w-2 text-[9px]">{open ? '▾' : '▸'}</span>Test output
      </button>
      {open ? (
        <div className="mt-1 space-y-1 text-[11px] leading-[1.5] text-slate-400" data-testid="foundry-failure-detail">
          <p className="text-slate-300">{failure.title}</p>
          {failure.command ? <p className="foundry-q-mono"><span className="text-slate-500">command</span> {failure.command}<span className="text-slate-500"> · exit</span> {failure.exitCode ?? '—'}</p> : null}
          {failure.cause ? <p><span className="text-slate-500">failure class</span> {failure.cause}</p> : null}
          {failure.hypothesis ? <p><span className="text-slate-500">debug hypothesis</span> {failure.hypothesis}</p> : null}
          {failure.repairTarget ? <p><span className="text-slate-500">repair target</span> {failure.repairTarget}</p> : null}
          {failure.outputTail ? <pre className="foundry-q-mono max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10.5px] text-emerald-100/70">{failure.outputTail}</pre> : null}
        </div>
      ) : null}
    </div>
  )
}

function Progress({ thread }: { thread: QuietThread }) {
  const p = thread.progress
  // The live panel carries every stage and its real state; the narrative below says, in plain language, what just happened.
  return (
    <div data-testid="foundry-quiet-progress" aria-live="polite">
      <FoundryLiveProgressPanel progress={thread.live} plan={thread.plan} />
      {p.narrative.length ? (
        <div className="mt-2 space-y-0.5 text-[14px] leading-[1.55] text-slate-200" data-testid="foundry-progress-narrative">
          {p.narrative.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
        </div>
      ) : null}
      {p.failure ? <FailureLine failure={p.failure} /> : null}
    </div>
  )
}

function Completion({ completion, onViewChanges, onOpenPreview, onOpenFiles, onRunTests, commit }: {
  completion: NonNullable<QuietThread['completion']>
  onViewChanges: () => void
  onOpenPreview: () => void
  onOpenFiles: () => void
  onRunTests: () => void
  commit?: ReactNode
}) {
  const button = 'rounded-md bg-white/[0.05] px-2.5 py-1 text-[12px] text-slate-200 hover:bg-white/[0.09]'
  return (
    <div data-testid="foundry-completion-card" data-completion-state={completion.rolledBack ? 'rolled_back' : 'completed'}>
      <p className="text-[15px] font-semibold text-emerald-300" data-testid="foundry-project-ready-label"><span aria-hidden="true">✓ </span>{completion.headline}</p>
      <p className="mt-0.5 text-[13px] text-slate-300" data-testid="foundry-completion-history-evidence">
        {completion.facts.join(' · ')}
        {completion.diff ? <span className="ml-2 foundry-q-mono text-[11px] text-slate-500">{completion.diff}</span> : null}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={button} onClick={onViewChanges}>View changes</button>
        <button type="button" className={button} onClick={onOpenPreview}>Open preview</button>
        <button type="button" className={button} onClick={onOpenFiles}>Open files</button>
        <button type="button" className={button} onClick={onRunTests}>Run tests</button>
      </div>
      {completion.rolledBack ? (
        <div className="mt-2.5" data-testid="foundry-completion-rolled-back">
          <p className="text-[14px] font-medium text-amber-200/90"><span aria-hidden="true">↶ </span>Rolled back</p>
          <p className="text-[12.5px] text-slate-400">{completion.rolledBackLine}</p>
        </div>
      ) : null}
      {commit}
    </div>
  )
}

function Intervention({ intervention, onRetry, onReview, onStop, onOpenModels, onApprove, onCancel, onDetails }: {
  intervention: NonNullable<QuietThread['intervention']>
  onRetry?: () => void
  onReview?: () => void
  onStop: () => void
  onOpenModels?: () => void
  onApprove?: () => void
  onCancel?: () => void
  onDetails?: () => void
}) {
  const [details, setDetails] = useState(false)
  const t = intervention.technical
  const handlers: Record<string, (() => void) | undefined> = {
    retry: onRetry,
    review: () => { setDetails(true); onReview?.() },
    stop: onStop,
    models: onOpenModels,
    approve: onApprove,
    cancel: onCancel,
    details: () => { setDetails(true); onDetails?.() },
  }
  return (
    <div
      data-testid={intervention.kind === 'paused' ? 'foundry-engineering-blocked' : 'foundry-intervention'}
      data-intervention-kind={intervention.kind}
      className="rounded-lg border-l-2 border-amber-400/70 bg-amber-400/[0.05] px-3.5 py-3"
    >
      <p className="text-[14px] font-medium text-amber-100" data-testid="foundry-intervention-title">{intervention.title}</p>
      <p className="mt-1 text-[13px] leading-[1.5] text-slate-300" data-testid="foundry-intervention-body">{intervention.body}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {intervention.actions.map(action => (
          <button
            key={action.id}
            type="button"
            data-testid={`foundry-intervention-${action.id}`}
            disabled={!handlers[action.id]}
            className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[12px] text-slate-100 hover:bg-white/[0.1] disabled:opacity-40"
            onClick={() => handlers[action.id]?.()}
          >
            {action.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="foundry-intervention-technical-toggle"
        aria-expanded={details}
        className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
        onClick={() => setDetails(value => !value)}
      >
        <span aria-hidden="true" className="inline-block w-2 text-[9px]">{details ? '▾' : '▸'}</span>Technical details
      </button>
      {details ? (
        <div className="mt-1 space-y-0.5 text-[11px] leading-[1.5] text-slate-400" data-testid="foundry-intervention-technical">
          <p><span className="text-slate-500">state</span> <span className="foundry-q-mono">{t.rawState}</span></p>
          {t.failure ? <p><span className="text-slate-500">failure</span> {t.failure}</p> : null}
          {t.attempts?.length ? <p><span className="text-slate-500">attempts</span> {t.attempts.join('; ')}</p> : null}
          {t.currentState ? <p><span className="text-slate-500">current state</span> {t.currentState}</p> : null}
          {t.rolledBack !== undefined ? <p><span className="text-slate-500">rolled back</span> {t.rolledBack ? 'yes' : 'no'}</p> : null}
          {t.progress?.length ? (
            <div className="mt-1 space-y-0.5 foundry-q-mono text-[10.5px] text-slate-400" data-testid="foundry-intervention-progress-evidence">
              {t.progress.map((line, index) => <p key={index}>{line}</p>)}
            </div>
          ) : null}
          {t.boundary ? <p><span className="text-slate-500">boundary</span> {t.boundary}</p> : null}
          {t.unblock ? <p><span className="text-slate-500">needs</span> {t.unblock}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export function FoundryQuietThread({
  thread,
  onOpenFile,
  onOpenRaw,
  onStop,
  onRetry,
  onReviewProblem,
  onOpenModels,
  onApprove,
  onCancelApproval,
  onDetails,
  onViewChanges,
  onOpenPreview,
  onOpenFiles,
  onRunTests,
  commit,
  note,
  defaultActivityOpen = false,
}: {
  thread: QuietThread
  onOpenFile: (path: string) => void
  onOpenRaw: (ref?: string) => void
  onStop: () => void
  onRetry?: () => void
  onReviewProblem?: () => void
  onOpenModels?: () => void
  onApprove?: () => void
  onCancelApproval?: () => void
  onDetails?: () => void
  onViewChanges: () => void
  onOpenPreview: () => void
  onOpenFiles: () => void
  onRunTests: () => void
  commit?: ReactNode
  note?: string | null
  defaultActivityOpen?: boolean
}) {
  return (
    <div data-testid="foundry-quiet-thread" className="space-y-3 text-[14px] leading-[1.55]">
      <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/55">Foundry</p>
      {thread.progress.working && !thread.intervention ? <Progress thread={thread} /> : <FoundryLiveProgressPanel progress={thread.live} plan={thread.plan} />}
      {thread.completion ? (
        <Completion
          completion={thread.completion}
          onViewChanges={onViewChanges}
          onOpenPreview={onOpenPreview}
          onOpenFiles={onOpenFiles}
          onRunTests={onRunTests}
          commit={commit}
        />
      ) : null}
      {thread.intervention ? (
        <Intervention
          intervention={thread.intervention}
          onRetry={onRetry}
          onReview={onReviewProblem}
          onStop={onStop}
          onOpenModels={onOpenModels}
          onApprove={onApprove}
          onCancel={onCancelApproval}
          onDetails={onDetails}
        />
      ) : null}
      {note ? <p className="text-[13px] text-amber-100/90" data-testid="foundry-continue-note">{note}</p> : null}
      <FoundryEngineeringActivity items={thread.activity} onOpenFile={onOpenFile} onOpenRaw={onOpenRaw} onStop={onStop} defaultOpen={defaultActivityOpen} />
    </div>
  )
}
