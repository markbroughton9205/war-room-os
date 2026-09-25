'use client'

import { useState } from 'react'
import type { FoundryContractVerdictView, FoundryCriterionUiRow } from '@/lib/native-builder/foundryContractVerdictView.types'

type Props = {
  view: FoundryContractVerdictView | null | undefined
  advanced?: boolean
  showApprovalCopy?: boolean
  onApproveExecution?: () => void
}

function statusClass(status: string): string {
  if (status === 'PASS') return 'text-emerald-300'
  if (status === 'FAIL' || status === 'FAILED') return 'text-red-300'
  if (status === 'STALE' || status === 'BLOCKED' || status === 'NEEDS COMMANDER') return 'text-amber-200'
  if (status === 'MISSING' || status === 'INCONCLUSIVE' || status === 'NEEDS EVIDENCE') return 'text-cyan-200'
  return 'text-slate-300'
}

function compactPrevious(hash: string | null | undefined): string {
  const value = String(hash ?? '').trim()
  if (!value) return '—'
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function HashLine({ label, compact, full, advanced }: { label: string; compact: string; full: string | null; advanced?: boolean }) {
  return (
    <p className="text-[10px] text-slate-300">
      <span className="text-slate-500">{label}: </span>
      <span title={full ?? compact} className="font-mono">{compact}</span>
      {full && full !== '—' ? (
        <button
          type="button"
          className="ml-2 rounded border border-white/15 px-1 text-[8px] uppercase tracking-widest text-slate-400"
          aria-label={`Copy ${label} hash`}
          onClick={() => void navigator.clipboard?.writeText(full).catch(() => undefined)}
        >
          Copy
        </button>
      ) : null}
      {advanced && full ? <span className="ml-2 break-all font-mono text-[9px] text-slate-500">{full}</span> : null}
    </p>
  )
}

function CriterionRow({ row, advanced }: { row: FoundryCriterionUiRow; advanced?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded border border-white/10 px-2 py-1" data-testid="foundry-criterion-row" data-criterion-id={row.criterionId} data-status={row.status}>
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span>
          <span className="font-mono text-[10px] text-slate-400">{row.criterionId}</span>
          <span className="ml-2 text-[10px] text-slate-200">{row.description}</span>
          <span className="ml-2 text-[9px] uppercase tracking-widest text-slate-500">{row.verificationType} · {row.required ? 'required' : 'optional'}</span>
        </span>
        <span className={`text-[9px] font-bold uppercase tracking-widest ${statusClass(row.status)}`} aria-label={`Criterion ${row.criterionId} ${row.status}`}>
          {row.status}
        </span>
      </button>
      {row.producer ? (
        <p className="mt-0.5 text-[9px] text-slate-500">
          {row.producer}{row.timestamp ? ` · ${row.timestamp}` : ''}{row.commandReference ? ` · ${row.commandReference}` : ''}
        </p>
      ) : null}
      {open || advanced ? (
        <div className="mt-1 space-y-0.5 text-[9px] text-slate-500" data-testid="foundry-criterion-advanced">
          {row.evidenceId ? <p>evidenceId {row.evidenceId}</p> : <p>No bound evidence record.</p>}
          {row.result ? <p>result {row.result}</p> : null}
          {row.artifactReference ? <p>artifact {row.artifactReference}</p> : null}
          {row.contentHash ? <p className="font-mono">hash {row.contentHash}</p> : null}
          {row.specVersion ? <p>spec {row.specVersion}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

export function FoundryContractVerdictPanel({ view, advanced, showApprovalCopy, onApproveExecution }: Props) {
  if (!view) return null
  const readyTone = view.projectReadyAdmissible && view.verdict === 'PASS'
  return (
    <section className="space-y-2" data-testid="foundry-contract-verdict-panel">
      {view.legacy ? (
        <div className="rounded border border-white/15 bg-black/20 p-2" data-testid="foundry-legacy-mission" aria-label="Legacy mission">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">LEGACY MISSION</p>
          <p className="mt-1 text-[10px] text-slate-400">Pre-contract mission; Standalone Engineer contract gates do not apply.</p>
        </div>
      ) : (
        <>
          <div className="rounded border border-white/10 bg-black/20 p-2" data-testid="foundry-contract-summary" aria-label="Mission contract">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Contract</p>
            <p className="mt-1 text-[10px] text-slate-300">
              Mission Contract · {view.missionContract.status ?? 'none'} · {view.missionContract.engineeringClass} · spec {view.missionContract.specVersion ?? '—'}
            </p>
            <HashLine label="Mission" compact={view.missionContract.compactHash} full={view.missionContract.hash} advanced={advanced} />
            {advanced && view.missionContract.id ? <p className="font-mono text-[9px] text-slate-500">{view.missionContract.id}</p> : null}
            <p className="mt-1 text-[10px] text-slate-300">
              Acceptance Contract · {view.acceptanceContract.status ?? 'none'} · {view.acceptanceContract.criterionCount} criteria
            </p>
            <HashLine label="Acceptance" compact={view.acceptanceContract.compactHash} full={view.acceptanceContract.hash} advanced={advanced} />
            {advanced && view.acceptanceContract.id ? <p className="font-mono text-[9px] text-slate-500">{view.acceptanceContract.id}</p> : null}
          </div>

          {view.approval ? (
            <div className="rounded border border-white/10 bg-black/20 p-2" data-testid="foundry-execution-approval" aria-label="Execution approval">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Approval</p>
              <p className={`text-[10px] font-bold uppercase tracking-widest ${view.approval.superseded || view.reapprovalRequired ? 'text-amber-200' : 'text-slate-200'}`}>
                {view.reapprovalRequired || view.approval.superseded ? 'APPROVAL SUPERSEDED' : view.approval.status}
              </p>
              {view.approval.approvedAt ? <p className="text-[9px] text-slate-500">approved {view.approval.approvedAt}</p> : null}
              <p className="text-[10px] text-slate-300">Spec v{view.approval.specVersion ?? '—'}</p>
              <HashLine label="Approved Mission" compact={view.approval.missionCompactHash} full={view.approval.missionHash} advanced={advanced} />
              <HashLine label="Approved Acceptance" compact={view.approval.acceptanceCompactHash} full={view.approval.acceptanceHash} advanced={advanced} />
            </div>
          ) : null}

          {view.reapprovalRequired ? (
            <div className="rounded border border-amber-400/40 bg-amber-950/20 p-2" data-testid="foundry-contract-updated" aria-label="Contract updated, re-approval required">
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">CONTRACT UPDATED</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-200">RE-APPROVAL REQUIRED</p>
              <p className="mt-1 text-[10px] text-amber-100">
                old spec {view.previousSpecVersion ?? '—'} → new spec {view.specVersion ?? '—'}
              </p>
              <p className="font-mono text-[10px] text-amber-100">
                old {view.previousMissionHash ? `${view.previousMissionHash.slice(0, 8)}…` : '—'} → new {view.missionContract.compactHash}
              </p>
            </div>
          ) : null}

          <div className="rounded border border-white/10 bg-black/20 p-2" data-testid="foundry-acceptance-criteria" aria-label="Acceptance criteria">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Acceptance</p>
            <ul className="mt-1 space-y-1">
              {view.criteria.map(row => <CriterionRow key={row.criterionId} row={row} advanced={advanced} />)}
            </ul>
          </div>

          <div
            className={`rounded border p-2 ${readyTone ? 'border-emerald-400/40 bg-emerald-950/20' : 'border-white/10 bg-black/20'}`}
            data-testid="foundry-mission-verdict"
            aria-label="Mission verdict"
            data-verdict={view.verdict}
            data-project-ready={view.projectReadyAdmissible && view.verdict === 'PASS' ? 'true' : 'false'}
          >
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Verdict</p>
            <p className={`text-sm font-bold uppercase tracking-widest ${statusClass(view.verdict)}`}>{view.verdict}</p>
            <p className="text-[10px] text-slate-300">{view.verdictReason}</p>
            {view.evaluatedAt ? <p className="text-[9px] text-slate-500">evaluated {view.evaluatedAt}</p> : null}
            <p className="text-[9px] text-slate-500">spec {view.specVersion ?? '—'} · generation {view.missionContract.compactHash}</p>
            <p className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${readyTone ? 'text-emerald-300' : 'text-slate-400'}`}>
              {view.truthfulHeadline}
            </p>
            {view.completionRefusedReason ? (
              <p className="mt-1 text-[10px] text-amber-100" data-testid="foundry-completion-refused-reason">{view.completionRefusedReason}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-cyan-100" data-testid="foundry-next-action">{view.nextAction}</p>
            <p className="mt-2 text-[9px] text-slate-500">
              VERIFIER produces evidence. REVIEWER is independent analysis. VERDICT decides whether completion is admissible. REVIEWER PASS is not PROJECT READY.
            </p>
            {view.reviewOutcome ? <p className="text-[9px] uppercase tracking-widest text-slate-400">Reviewer {view.reviewOutcome}</p> : null}
          </div>

          {showApprovalCopy || view.reapprovalRequired ? (
            <div className="rounded border border-amber-400/30 bg-amber-950/10 p-2" data-testid="foundry-approve-execution-copy" aria-label="Approve execution">
              {view.reapprovalRequired ? (
                <>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">APPROVE UPDATED EXECUTION</p>
                  <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">Previous approval</p>
                  <p className="text-[10px] text-amber-100">Spec: v{view.previousSpecVersion ?? '—'}</p>
                  <p className="font-mono text-[10px] text-amber-100">Mission Contract: {compactPrevious(view.previousMissionHash)}</p>
                  <p className="font-mono text-[10px] text-amber-100">Acceptance Contract: {compactPrevious(view.previousAcceptanceHash)}</p>
                  <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">Current</p>
                </>
              ) : (
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">APPROVE EXECUTION</p>
              )}
              <p className="mt-1 text-[10px] text-amber-100">Spec version: {view.approvalCopy.specVersion}</p>
              <p className="font-mono text-[10px] text-amber-100">Mission Contract: {view.approvalCopy.missionCompactHash}</p>
              <p className="font-mono text-[10px] text-amber-100">Acceptance Contract: {view.approvalCopy.acceptanceCompactHash}</p>
              <p className="mt-1 text-[10px] text-slate-300">This approval binds execution to those exact contract hashes.</p>
              {view.reapprovalRequired ? <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-amber-200">RE-APPROVAL REQUIRED</p> : null}
              {onApproveExecution ? (
                <button
                  type="button"
                  className="mt-2 rounded border border-emerald-400/40 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-200"
                  onClick={onApproveExecution}
                >
                  {view.reapprovalRequired ? 'Approve updated execution' : 'Approve execution'}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {advanced ? (
        <div className="rounded border border-white/10 p-2 text-[9px] text-slate-500" data-testid="foundry-contract-advanced">
          <p>schemaVersion {view.schemaVersion}</p>
          <p>missionId {view.missionId}</p>
          {view.missionContract.id ? <p>missionContractId {view.missionContract.id}</p> : null}
          {view.acceptanceContract.id ? <p>acceptanceContractId {view.acceptanceContract.id}</p> : null}
          {view.approvalHistory.length ? (
            <div data-testid="foundry-approval-history">
              <p>approval history</p>
              {view.approvalHistory.map(item => (
                <p key={item.approvalId}>{item.status} {item.approvalId} spec {item.specVersion} {item.missionCompactHash}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
