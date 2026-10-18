'use client'

import type { LiveProgress, LiveStep, LiveStepState } from '@/lib/native-builder/foundryLiveProgress'
import type { PlanSummary } from '@/lib/native-builder/foundryEngineeringPlan'

/**
 * The Commander's live mission panel. Every row is a real stage whose state comes from the persisted mission record
 * (foundryLiveProgress.ts). Nothing here is timer-driven: the only animation is the pulse on the one active row, which is
 * decoration and never moves the count. Raw internals are not rendered; they live under Activity / Technical details.
 */

const MARK: Record<LiveStepState, { icon: string; className: string }> = {
  QUEUED: { icon: '○', className: 'text-slate-600' },
  RUNNING: { icon: '●', className: 'text-emerald-300' },
  PASS: { icon: '✓', className: 'text-emerald-400/90' },
  FAIL: { icon: '✕', className: 'text-red-400' },
  PAUSED: { icon: '●', className: 'text-amber-300' },
  SKIPPED: { icon: '✓', className: 'text-slate-500' },
}

function textClass(state: LiveStepState): string {
  if (state === 'RUNNING') return 'text-[14px] font-medium text-emerald-50'
  if (state === 'PAUSED') return 'text-[14px] font-medium text-amber-100'
  if (state === 'FAIL') return 'text-[13px] text-red-200'
  if (state === 'QUEUED') return 'text-[13px] text-slate-600'
  if (state === 'SKIPPED') return 'text-[13px] text-slate-500'
  return 'text-[13px] text-slate-300'
}

function Row({ step }: { step: LiveStep }) {
  const mark = MARK[step.state]
  return (
    <li data-testid="foundry-live-step" data-step-id={step.id} data-step-state={step.state} aria-current={step.state === 'RUNNING' || step.state === 'PAUSED' ? 'step' : undefined}>
      <p className={`flex items-baseline gap-2 ${textClass(step.state)}`}>
        <span className={`${mark.className} ${step.state === 'RUNNING' ? 'foundry-q-pulse' : ''} inline-block w-3 text-center`} aria-hidden="true">{mark.icon}</span>
        <span data-testid="foundry-live-step-label">{step.label}</span>
      </p>
      {step.detail ? <p className="ml-5 text-[12px] leading-[1.45] text-slate-400" data-testid="foundry-live-step-detail">{step.detail}</p> : null}
      {step.notes.map((note, index) => (
        <p key={`${index}-${note.text}`} className={`ml-5 text-[12.5px] leading-[1.5] ${note.state === 'RUNNING' ? 'text-cyan-100/90' : 'text-slate-400'}`} data-testid="foundry-live-step-note" data-note-state={note.state}>
          <span className={`${note.state === 'RUNNING' ? 'text-cyan-300' : 'text-emerald-400/80'} mr-1.5`} aria-hidden="true">{note.state === 'RUNNING' ? '●' : note.state === 'FAIL' ? '✕' : '✓'}</span>{note.text}
        </p>
      ))}
    </li>
  )
}

export function FoundryLiveProgressPanel({ progress, loading = false, plan = null }: { progress: LiveProgress | null; loading?: boolean; plan?: PlanSummary | null }) {
  if (loading || !progress) {
    // Persisted progress is being read: never show an empty 0/N in the meantime.
    return <p className="text-[13px] text-slate-400" data-testid="foundry-live-progress-loading">Loading mission progress…</p>
  }
  return (
    <div data-testid="foundry-live-progress-panel" data-progress-status={progress.status} aria-live="polite">
      <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-emerald-300/80" data-testid="foundry-live-progress-count" data-done={progress.done} data-total={progress.total}>{progress.countLabel}</p>
      <ul className="space-y-1">
        {progress.steps.map(step => <Row key={step.id} step={step} />)}
      </ul>
      {plan ? (
        <div className="mt-2 border-t border-slate-800/70 pt-2" data-testid="foundry-plan">
          <p className="text-[12.5px] leading-[1.5] text-slate-300" data-testid="foundry-plan-summary">{progress.status === 'complete' ? plan.retrospective : (plan.lastRevision ?? plan.headline)}</p>
          <details className="mt-1" data-testid="foundry-plan-details">
            <summary className="cursor-pointer text-[11.5px] text-slate-500">Plan</summary>
            <p className="mt-1 text-[12px] leading-[1.5] text-slate-400">{plan.headline}</p>
            <ol className="mt-1 list-decimal pl-5 text-[12px] leading-[1.5] text-slate-400">{plan.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
          </details>
        </div>
      ) : null}
    </div>
  )
}
