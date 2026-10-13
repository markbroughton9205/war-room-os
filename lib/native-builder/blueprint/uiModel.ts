/**
 * Pure view-model helpers for the Commander blueprint surface. Truthfulness rules live here (and are unit-checked by the live validator): unknown or missing data is
 * rendered as UNKNOWN, never hidden or defaulted to a healthy value; "built"/"packaged" only ever come from the lineage view; nothing here claims install, task,
 * mission or assignment completion.
 */
export type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' && v ? v : 'UNKNOWN')

export type ApprovalView = { label: 'NOT_APPROVED' | 'APPROVED_USABLE' | 'STALE' | 'EXPIRED' | 'CONSUMED' | 'UNKNOWN'; stale: string[]; detail: string; mustReapprove: boolean }
export function approvalView(approval: unknown): ApprovalView {
  const a = obj(approval)
  if (!('approved' in a)) return { label: 'UNKNOWN', stale: [], detail: 'Approval state unavailable.', mustReapprove: false }
  if (a.approved !== true) return { label: 'NOT_APPROVED', stale: [], detail: 'No approval recorded for this exact content.', mustReapprove: false }
  const stale = Array.isArray(a.stale) ? (a.stale as string[]) : []
  if (stale.length) return { label: 'STALE', stale, detail: `Bound input changed since approval: ${stale.join(', ')}. This approval can no longer be used; review the preview and approve again.`, mustReapprove: true }
  if (a.expired === true) return { label: 'EXPIRED', stale, detail: 'Approval expired. Approve again.', mustReapprove: true }
  if (a.consumed === true) return { label: 'CONSUMED', stale, detail: 'Approval was consumed by an execution.', mustReapprove: false }
  if (a.usable === true) return { label: 'APPROVED_USABLE', stale, detail: 'Bound to the exact package, base, checks, ownership and recipe shown here.', mustReapprove: false }
  return { label: 'UNKNOWN', stale, detail: 'Approval usability could not be determined.', mustReapprove: false }
}

export type ClaimRow = { key: string; label: string; value: 'YES' | 'NO' | 'UNKNOWN' }
/** Claims come only from the authoritative lineage view; with no lineage, built/packaged are UNKNOWN (status() never claims them). */
export function claimRows(projection: unknown, lineage: unknown): ClaimRow[] {
  const p = obj(obj(projection).claims), l = obj(obj(lineage).claims), hasLineage = Object.keys(l).length > 0
  const yn = (v: unknown): 'YES' | 'NO' => (v === true ? 'YES' : 'NO')
  return [
    { key: 'sourceValidated', label: 'Source validated', value: 'sourceValidated' in p ? yn(p.sourceValidated) : 'UNKNOWN' },
    { key: 'built', label: 'Bundled by wr-bundle-build (verified; NOT the desktop build)', value: hasLineage ? yn(l.built) : 'UNKNOWN' },
    { key: 'packaged', label: 'Packed by wr-bundle-pack (verified; NOT a production package)', value: hasLineage ? yn(l.packaged) : 'UNKNOWN' },
    { key: 'installed', label: 'Installed', value: 'NO' },
    { key: 'taskComplete', label: 'Task / mission / assignment complete', value: 'NO' },
  ]
}

export type StageRow = { stage: string; status: string; note: string }
export function stageRows(lineage: unknown): StageRow[] {
  const cur = obj(obj(lineage).current)
  return ['source', 'dependencies', 'build', 'package'].map(stage => {
    const c = obj(cur[stage]); const status = typeof c.status === 'string' ? c.status : 'UNKNOWN'
    const changed = Array.isArray(c.changed) && c.changed.length ? ` changed: ${(c.changed as string[]).join(', ')}` : ''
    return { stage, status, note: `${c.receiptId ? `receipt ${String(c.receiptId)}` : 'no receipt'}${changed}` }
  })
}

export type ArtifactRow = { stage: string; name: string; path: string; sha256: string; bytes: string; runId: string; verification: string }
export function artifactRows(artifacts: unknown): { rows: ArtifactRow[]; verification: string } {
  const a = obj(artifacts), stages = obj(a.stages), ver = obj(a.verification)
  if (a.unavailable === true) return { rows: [], verification: 'UNAVAILABLE' }
  const rows: ArtifactRow[] = []
  for (const stage of ['build', 'package']) {
    const s = obj(stages[stage]); const v = obj(ver[stage]); const vs = !Object.keys(ver).length ? 'NOT_VERIFIED' : v.ok === true ? 'VERIFIED' : v.ok === false ? `FAILED (${(Array.isArray(v.problems) ? (v.problems as Json[]).map(p => str(p.code)).join(', ') : 'unknown')})` : 'UNKNOWN'
    for (const e of (Array.isArray(s.entries) ? (s.entries as Json[]) : [])) rows.push({ stage, name: str(e.name), path: str(e.path), sha256: str(e.sha256), bytes: e.bytes == null ? 'UNKNOWN' : String(e.bytes), runId: str(e.runId), verification: vs })
  }
  return { rows, verification: Object.keys(ver).length ? `recorded ${str(ver.receiptId)}` : 'NOT_VERIFIED' }
}

export const writeCapableLabel = (authority: unknown): string => { const a = obj(authority), w = obj(a.assignment); return w.writeCapable === true ? 'write-capable' : w.writeCapable === false ? 'NOT write-capable' : 'UNKNOWN' }

export type DepRow = { name: string; version: string; state: string; approved: string; reasons: string }
/** Reads describeDependencies(): {plan, verification:{deps[]}, approvals{name@version}}. Missing data is UNKNOWN, never "none". */
export function dependencyRows(deps: unknown): { rows: DepRow[]; plan: string } {
  const d = obj(deps), v = obj(d.verification), ap = obj(d.approvals)
  const rows = (Array.isArray(v.deps) ? (v.deps as Json[]) : []).map(x => ({ name: str(x.name), version: str(x.version), state: str(x.state), approved: `${str(x.name)}@${str(x.version)}` in ap ? (ap[`${str(x.name)}@${str(x.version)}`] === true ? 'APPROVED' : 'NOT_APPROVED') : 'UNKNOWN', reasons: Array.isArray(x.reasons) ? (x.reasons as unknown[]).map(String).join(', ') : '' }))
  return { rows, plan: str(obj(d.plan).status) }
}
export const recoveryLabel = (v: unknown): string => { const o = obj(v); if (o.unavailable === true) return 'UNKNOWN (recovery view unavailable)'; if (!v) return 'none recorded'; const bits = ['build', 'package'].map(k => { const c = obj(o[k]); return c.classification ? `${k}:${String(c.classification)}` : null }).filter(Boolean); return bits.length ? bits.join(' ') : 'none recorded' }
