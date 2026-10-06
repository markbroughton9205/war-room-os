/**
 * Maps existing HVS QC jobs / kernel reports / tool receipts onto DETERMINISTIC_QC.
 * Does not invent detectors. Does not infer PASS from render existence.
 */
import type { HvsJob } from './jobs'
import type { HvsQcReport, HvsQcState, HvsToolReceipt } from './tool-kernel/types'
import type { HvsQcEvidenceRef, HvsVerificationVerdict } from './verification-classes'

export type HvsRenderIdentity = {
  path?: string | null
  hash?: string | null
  jobId?: string | null
  versionId?: string | null
}

export type HvsDeterministicQcResolution = {
  verdict: Exclude<HvsVerificationVerdict, 'NOT_APPLICABLE'>
  evidence: HvsQcEvidenceRef
}

type Candidate = {
  verdict: Exclude<HvsQcState, 'NOT_RUN'>
  path?: string | null
  hash?: string | null
  renderJobId?: string | null
  versionId?: string | null
  qcJobId?: string | null
  reportId?: string | null
  receiptId?: string | null
  timestamp?: string | null
}

function hasIdentity(identity?: HvsRenderIdentity | null): boolean {
  return Boolean(identity?.path || identity?.hash || identity?.jobId || identity?.versionId)
}

function matchesRender(identity: HvsRenderIdentity, candidate: Candidate): boolean {
  if (identity.hash && candidate.hash) return identity.hash === candidate.hash
  if (identity.path && candidate.path) return identity.path === candidate.path
  if (identity.jobId && candidate.renderJobId) return identity.jobId === candidate.renderJobId
  if (identity.versionId && candidate.versionId) return identity.versionId === candidate.versionId
  return false
}

function asOutcome(value: unknown): Exclude<HvsQcState, 'NOT_RUN'> | null {
  if (value === 'PASS' || value === 'FAIL' || value === 'NEEDS_HUMAN') return value
  return null
}

function fromFindings(findings: unknown): Exclude<HvsQcState, 'NOT_RUN'> | null {
  if (!Array.isArray(findings) || !findings.length) return null
  const severities = findings.map(row => (row && typeof row === 'object' && 'severity' in row ? String((row as { severity?: string }).severity) : ''))
  if (severities.some(row => row === 'fail')) return 'FAIL'
  if (severities.some(row => row === 'warn')) return 'NEEDS_HUMAN'
  return 'PASS'
}

export function candidatesFromExistingQc(input: {
  jobs?: HvsJob[]
  receipts?: HvsToolReceipt[]
  reports?: HvsQcReport[]
}): Candidate[] {
  const rows: Candidate[] = []
  for (const report of input.reports ?? []) {
    if (!report?.outcome) continue
    rows.push({
      verdict: report.outcome,
      path: report.path,
      hash: report.hash,
      reportId: report.schema,
      timestamp: report.ranAt,
    })
  }
  for (const receipt of input.receipts ?? []) {
    if (receipt.toolName !== 'hvs.qc.run') continue
    const state = receipt.qcState
    if (state === 'NOT_RUN' || receipt.status === 'QUEUED' || receipt.status === 'RUNNING') continue
    const verdict = state === 'FAIL' || receipt.status === 'FAILED' ? 'FAIL' : state === 'NEEDS_HUMAN' ? 'NEEDS_HUMAN' : state === 'PASS' ? 'PASS' : null
    if (!verdict) continue
    const path = receipt.outputAssetRefs[0]?.path ?? (typeof receipt.result === 'object' && receipt.result && 'path' in receipt.result ? String((receipt.result as { path?: string }).path ?? '') : null)
    rows.push({
      verdict,
      path: path || null,
      hash: receipt.hashes.master ?? receipt.hashes.output ?? receipt.outputAssetRefs[0]?.hash ?? null,
      receiptId: receipt.jobId,
      qcJobId: receipt.jobId,
      timestamp: receipt.completedAt ?? receipt.startedAt,
    })
  }
  for (const job of input.jobs ?? []) {
    if (job.kind !== 'qc') continue
    const path = typeof job.inputs.file === 'string'
      ? job.inputs.file
      : typeof job.outputs.outputPath === 'string'
        ? job.outputs.outputPath
        : typeof job.outputs.path === 'string'
          ? job.outputs.path
          : null
    const hash = typeof job.outputs.hash === 'string' ? job.outputs.hash : null
    const renderJobId = typeof job.inputs.renderJobId === 'string' ? job.inputs.renderJobId : null
    if (job.status === 'FAILED') {
      rows.push({
        verdict: 'FAIL',
        path,
        hash,
        renderJobId,
        versionId: job.versionId,
        qcJobId: job.id,
        reportId: typeof job.outputs.reportId === 'string' ? job.outputs.reportId : null,
        timestamp: job.completedAt ?? job.createdAt,
      })
      continue
    }
    if (job.status !== 'COMPLETED') continue
    const verdict = asOutcome(job.outputs.outcome) ?? fromFindings(job.outputs.findings)
    if (!verdict) continue
    rows.push({
      verdict,
      path,
      hash,
      renderJobId,
      versionId: job.versionId,
      qcJobId: job.id,
      reportId: typeof job.outputs.reportId === 'string' ? job.outputs.reportId : 'hvs.qc.v1',
      timestamp: job.completedAt ?? job.createdAt,
    })
  }
  return rows.sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
}

export function resolveDeterministicQc(input: {
  jobs?: HvsJob[]
  receipts?: HvsToolReceipt[]
  reports?: HvsQcReport[]
  currentRender?: HvsRenderIdentity | null
}): HvsDeterministicQcResolution {
  const empty: HvsQcEvidenceRef = {
    qcJobId: null,
    reportId: null,
    receiptId: null,
    renderHash: input.currentRender?.hash ?? null,
    renderJobId: input.currentRender?.jobId ?? null,
    versionId: input.currentRender?.versionId ?? null,
    timestamp: null,
    path: input.currentRender?.path ?? null,
  }
  if (!hasIdentity(input.currentRender)) {
    return { verdict: 'NOT_RUN', evidence: empty }
  }
  const identity = input.currentRender as HvsRenderIdentity
  const match = candidatesFromExistingQc(input).find(row => matchesRender(identity, row))
  if (!match) {
    return { verdict: 'NOT_RUN', evidence: empty }
  }
  return {
    verdict: match.verdict,
    evidence: {
      qcJobId: match.qcJobId ?? null,
      reportId: match.reportId ?? null,
      receiptId: match.receiptId ?? null,
      renderHash: match.hash ?? identity.hash ?? null,
      renderJobId: match.renderJobId ?? identity.jobId ?? null,
      versionId: match.versionId ?? identity.versionId ?? null,
      timestamp: match.timestamp ?? null,
      path: match.path ?? identity.path ?? null,
    },
  }
}

export function currentRenderIdentity(project: {
  renderJobs?: Array<{
    id: string
    status: string
    outputPath?: string | null
    versionId?: string | null
    completedAt?: string | null
    createdAt?: string
  }>
  assets?: Array<{ id: string; outputOfRenderJobId?: string | null; checksumSha256?: string; originalPath?: string }>
}): HvsRenderIdentity | null {
  const last = [...(project.renderJobs ?? [])].reverse().find(job => job.status === 'completed' && job.outputPath)
  if (!last) return null
  const asset = project.assets?.find(row => row.outputOfRenderJobId === last.id || row.originalPath === last.outputPath)
  return {
    path: last.outputPath ?? null,
    hash: asset?.checksumSha256 ?? null,
    jobId: last.id,
    versionId: last.versionId ?? null,
  }
}
