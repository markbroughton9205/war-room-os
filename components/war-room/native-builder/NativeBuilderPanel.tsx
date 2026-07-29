'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  NativeIssueRecord,
  NativeRepairRecord,
} from '@/lib/native-builder/types'
import type { CanonicalSystemHealthSnapshot } from '@/lib/native-builder/systemHealthSnapshot'
import type { RepairScopeClassification } from '@/lib/native-builder/repairScopeClassifier'

type StatusResponse = {
  localModel: { available: boolean; models: string[]; detail: string }
  unresolvedIssueCount: number
  terminalOperations: readonly string[]
}

type SweepEntry = {
  check: CanonicalSystemHealthSnapshot['checks'][number]
  scope: RepairScopeClassification
  issue: NativeIssueRecord
  repair: NativeRepairRecord | null
}

const SCOPE_LABEL: Record<RepairScopeClassification, string> = {
  native_builder_repairable: 'War Room can attempt a code-level repair.',
  commander_action_required: 'COMMANDER ACTION REQUIRED',
  external_provider_account_action_required: 'EXTERNAL PROVIDER ACCOUNT ACTION REQUIRED',
  unclear: 'Scope unclear — diagnosis pending',
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function localReasoningLabelFor(status: StatusResponse | null): string {
  if (!status) return 'CHECKING…'
  return status.localModel.available ? 'LOCAL_REPAIR_READY (Ollama reachable)' : 'LOCAL_MODEL_UNAVAILABLE'
}

const STATE_LABEL: Record<string, string> = {
  detected: 'Detected',
  collecting_evidence: 'Collecting evidence',
  inspecting_repository: 'Inspecting repository',
  planning: 'Planning',
  awaiting_local_execution_approval: 'Awaiting Commander approval',
  applying_patch: 'Applying patch',
  validating: 'Validating',
  verification_failed: 'Verification failed',
  partially_verified: 'Partially verified',
  awaiting_commander_review: 'Awaiting Commander review',
  resolved: 'Resolved',
  rolled_back: 'Rolled back',
  blocked: 'Blocked',
  escalation_recommended: 'Escalation recommended',
  cancelled: 'Cancelled',
}

export function NativeBuilderPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [issues, setIssues] = useState<NativeIssueRecord[]>([])
  const [repairs, setRepairs] = useState<NativeRepairRecord[]>([])
  const [health, setHealth] = useState<CanonicalSystemHealthSnapshot | null>(null)
  const [sweepEntries, setSweepEntries] = useState<SweepEntry[]>([])
  const [selectedRepairId, setSelectedRepairId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const [reportTitle, setReportTitle] = useState('')
  const [reportSubsystem, setReportSubsystem] = useState('')
  const [reportDescription, setReportDescription] = useState('')

  const refresh = useCallback(async () => {
    const [statusRes, issuesRes, repairsRes, healthRes] = await Promise.all([
      fetch('/api/native-builder/status').then(r => r.json()).catch(() => null),
      fetch('/api/native-builder/issues').then(r => r.json()).catch(() => null),
      fetch('/api/native-builder/repairs').then(r => r.json()).catch(() => null),
      fetch('/api/native-builder/system-health').then(r => r.json()).catch(() => null),
    ])
    if (statusRes) setStatus(statusRes)
    if (issuesRes?.issues) setIssues(issuesRes.issues)
    if (repairsRes?.repairs) setRepairs(repairsRes.repairs)
    if (healthRes) setHealth(healthRes)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const selectedRepair = repairs.find(r => r.id === selectedRepairId) ?? null
  const selectedIssue = selectedRepair ? issues.find(i => i.id === selectedRepair.issueId) ?? null : null

  const runAction = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label)
      setLastError(null)
      try {
        await fn()
        await refresh()
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const runRepairSystemSweep = () => {
    void runAction('repair-system', async () => {
      const result = await postJson<{ snapshot: CanonicalSystemHealthSnapshot; entries: SweepEntry[] }>('/api/native-builder/repair-system', {})
      if (!result.ok) throw new Error(result.error)
      setSweepEntries(result.data?.entries ?? [])
      if (result.data?.snapshot) setHealth(result.data.snapshot)
    })
  }

  const submitReport = () => {
    if (!reportTitle.trim() || !reportSubsystem.trim() || !reportDescription.trim()) return
    void runAction('report', async () => {
      const result = await postJson('/api/native-builder/issues', {
        kind: 'commander_report',
        title: reportTitle,
        subsystem: reportSubsystem,
        description: reportDescription,
      })
      if (!result.ok) throw new Error(result.error)
      setReportTitle('')
      setReportSubsystem('')
      setReportDescription('')
    })
  }

  return (
    <div className="space-y-4 text-[11px] text-slate-300">
      <section className="rounded border border-emerald-500/20 bg-black/25 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">System Health</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div className="text-2xl font-bold text-white">
            {health ? (health.healthPercentage === null ? 'NOT FULLY EVALUATED' : `${health.healthPercentage}%`) : '—'}
          </div>
          <div className="text-slate-400">
            {health ? `${health.evaluatedChecks} of ${health.totalChecks} checks evaluated` : 'loading…'}
          </div>
          <div className="text-slate-400">{health?.unresolvedIssueCount ?? '—'} unresolved issues</div>
          <div className="text-slate-400">{health?.activeRepairMissionIds.length ?? 0} active repair missions</div>
          <div className="uppercase tracking-widest text-emerald-200">{health?.overallStatus ?? 'unknown'}</div>
          <button
            type="button"
            disabled={busy !== null}
            className="ml-auto rounded border border-red-400/60 bg-red-950/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-red-200 disabled:opacity-40"
            onClick={runRepairSystemSweep}
          >
            {busy === 'repair-system' ? 'Scanning…' : '[ REPAIR SYSTEM ]'}
          </button>
        </div>
        {sweepEntries.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-white/10 pt-2">
            {sweepEntries.map((entry, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-white">{entry.check.title}</span>
                <span className="text-slate-500">{entry.check.status}</span>
                <span className={entry.scope === 'native_builder_repairable' ? 'text-emerald-400' : entry.scope === 'unclear' ? 'text-slate-400' : 'text-amber-400'}>
                  {SCOPE_LABEL[entry.scope]}
                </span>
                {entry.repair ? (
                  <button
                    type="button"
                    className="text-cyan-300 underline"
                    onClick={() => setSelectedRepairId(entry.repair!.id)}
                  >
                    open mission
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded border border-white/10 bg-black/25 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">War Room Native Builder</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <div className="text-slate-500">Unresolved issues</div>
            <div className="text-lg font-bold text-white">{status?.unresolvedIssueCount ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">Local reasoning</div>
            <div className="text-white">{localReasoningLabelFor(status)}</div>
          </div>
          <div>
            <div className="text-slate-500">Terminal ops registered</div>
            <div className="text-white">{status?.terminalOperations.length ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">External escalation</div>
            <div className="text-white">visible exception only</div>
          </div>
        </div>
      </section>

      <section className="rounded border border-white/10 bg-black/25 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Report an issue</p>
        <div className="mt-2 space-y-2">
          <input
            className="w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Title"
            value={reportTitle}
            onChange={e => setReportTitle(e.target.value)}
          />
          <input
            className="w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Affected file / subsystem (repo-relative path)"
            value={reportSubsystem}
            onChange={e => setReportSubsystem(e.target.value)}
          />
          <textarea
            className="w-full rounded border border-white/10 bg-black/40 p-1.5 text-white"
            placeholder="Description"
            rows={2}
            value={reportDescription}
            onChange={e => setReportDescription(e.target.value)}
          />
          <button
            type="button"
            className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40"
            disabled={busy === 'report'}
            onClick={submitReport}
          >
            {busy === 'report' ? 'Reporting…' : 'Submit report'}
          </button>
        </div>
      </section>

      <section className="rounded border border-white/10 bg-black/25 p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Repairs</p>
        <ul className="mt-2 space-y-1">
          {repairs.length === 0 ? <li className="text-slate-500">No repairs opened yet.</li> : null}
          {repairs.map(r => {
            const issue = issues.find(i => i.id === r.issueId)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={`w-full rounded border px-2 py-1 text-left ${selectedRepairId === r.id ? 'border-emerald-400/60 bg-emerald-950/20' : 'border-white/10'}`}
                  onClick={() => setSelectedRepairId(r.id)}
                >
                  <span className="font-bold text-white">{issue?.title ?? r.issueId}</span>
                  <span className="ml-2 text-slate-500">{STATE_LABEL[r.state] ?? r.state}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {selectedRepair && selectedIssue ? (
        <section className="space-y-3 rounded border border-white/10 bg-black/25 p-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Issue</p>
            <p className="text-white">{selectedIssue.title}</p>
            <p className="text-slate-500">
              Severity: {selectedIssue.severity} · Source: {selectedIssue.source} · Occurrences: {selectedIssue.occurrenceCount} · Subsystem: {selectedIssue.affectedSubsystem}
            </p>
            <ul className="mt-1 list-disc pl-4 text-slate-400">
              {selectedIssue.evidence.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>

          {selectedRepair.selectedProposal ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">War Room Diagnosis</p>
              <p className="text-white">{selectedRepair.selectedProposal.diagnosis}</p>
              <p className="text-slate-500">
                Confidence: {selectedRepair.selectedProposal.confidence} · Source: {selectedRepair.selectedProposal.proposerId}
              </p>
              {selectedRepair.proposals.filter(p => p.sourceKind === 'council_family').length > 0 ? (
                <div className="mt-1">
                  <p className="text-slate-500">Competing council opinions (advisory):</p>
                  <ul className="list-disc pl-4 text-slate-400">
                    {selectedRepair.proposals.filter(p => p.sourceKind === 'council_family').map((p, i) => (
                      <li key={i}>
                        <span className="font-bold">{p.proposerId}:</span> {p.diagnosis}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedRepair.selectedProposal ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Repair Plan</p>
              <ul className="list-disc pl-4 text-slate-400">
                {selectedRepair.selectedProposal.plannedChanges.map((c, i) => (
                  <li key={i}>{c.file} — {c.reason}</li>
                ))}
              </ul>
              <p className="text-slate-500">Validations: {selectedRepair.selectedProposal.validations.map(v => v.id).join(', ')}</p>
              <p className="text-slate-500">Risks: {selectedRepair.selectedProposal.risks.join('; ')}</p>
              <p className="text-slate-500">Rollback plan: {selectedRepair.selectedProposal.rollbackPlan}</p>
              {selectedRepair.policyResult ? (
                <p className={selectedRepair.policyResult.ok ? 'text-emerald-400' : 'text-red-400'}>
                  Patch policy: {selectedRepair.policyResult.ok ? 'PASSED' : `FAILED (${selectedRepair.policyResult.violations.map(v => v.rule).join(', ')})`}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedRepair.validationResults.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Live Build Activity</p>
              <ul className="space-y-1">
                {selectedRepair.validationResults.map((v, i) => (
                  <li key={i} className={v.ok ? 'text-emerald-400' : 'text-red-400'}>
                    {v.operation.id}: {v.ok ? 'PASS' : `FAIL (exit ${v.exitCode})`} ({v.durationMs}ms)
                  </li>
                ))}
              </ul>
              {selectedRepair.verification ? (
                <p className="mt-1 text-slate-300">
                  Verification: <span className="font-bold">{selectedRepair.verification.status.toUpperCase()}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedRepair.diffEvidence ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Changes</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-2 text-[10px] text-slate-300">
                {selectedRepair.diffEvidence.diff || '(no diff captured)'}
              </pre>
            </div>
          ) : null}

          {selectedRepair.immunityOutcome ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {selectedRepair.immunityOutcome.created ? 'IMMUNITY ADDED' : 'No immunity artifact'}
              </p>
              {selectedRepair.immunityOutcome.created ? (
                <>
                  <p className="text-emerald-400">{selectedRepair.immunityOutcome.artifact.type}: {selectedRepair.immunityOutcome.artifact.description}</p>
                  <p className="text-slate-500">Files: {selectedRepair.immunityOutcome.artifact.files.join(', ') || '(none)'}</p>
                </>
              ) : (
                <p className="text-amber-400">{selectedRepair.immunityOutcome.reason}</p>
              )}
            </div>
          ) : null}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Commander Actions</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className="rounded border border-cyan-500/40 px-2 py-1 text-cyan-300 disabled:opacity-40"
                onClick={() => runAction('plan', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/plan`, {})
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Request re-analysis
              </button>
              <button
                type="button"
                disabled={busy !== null || selectedRepair.state !== 'awaiting_local_execution_approval'}
                className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40"
                onClick={() => runAction('approve', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/approve`, { approval_granted: true })
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Approve local repair
              </button>
              <button
                type="button"
                disabled={busy !== null || !['awaiting_commander_review', 'partially_verified'].includes(selectedRepair.state)}
                className="rounded border border-emerald-500/40 px-2 py-1 text-emerald-300 disabled:opacity-40"
                onClick={() => runAction('accept', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/resolve`, { accepted: true })
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Accept repair
              </button>
              <button
                type="button"
                disabled={busy !== null || !['awaiting_commander_review', 'partially_verified'].includes(selectedRepair.state)}
                className="rounded border border-red-500/40 px-2 py-1 text-red-300 disabled:opacity-40"
                onClick={() => runAction('reject', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/resolve`, { accepted: false, approval_granted: true })
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Reject plan
              </button>
              <button
                type="button"
                disabled={busy !== null || !['detected', 'collecting_evidence', 'inspecting_repository', 'planning', 'awaiting_local_execution_approval'].includes(selectedRepair.state)}
                className="rounded border border-slate-500/40 px-2 py-1 text-slate-300 disabled:opacity-40"
                onClick={() => runAction('cancel', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/cancel`, {})
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null || !['resolved', 'verification_failed', 'partially_verified', 'awaiting_commander_review'].includes(selectedRepair.state)}
                className="rounded border border-amber-500/40 px-2 py-1 text-amber-300 disabled:opacity-40"
                onClick={() => runAction('rollback', async () => {
                  const result = await postJson(`/api/native-builder/repairs/${selectedRepair.id}/rollback`, { approval_granted: true })
                  if (!result.ok) throw new Error(result.error)
                })}
              >
                Rollback
              </button>
            </div>
            {lastError ? <p className="mt-2 text-red-400">{lastError}</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
