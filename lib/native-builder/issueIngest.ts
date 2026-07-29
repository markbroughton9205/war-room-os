/**
 * Deterministic issue fingerprinting and ingestion. Pure functions only — no storage access here
 * (mirrors the lesson from the self-repair recursion fix: ingestion produces data, storage.ts
 * decides what to persist).
 */
import { createHash } from 'node:crypto'
import type { NativeIssueIngestInput, NativeIssueRecord } from './types'

function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    // strip volatile bits that shouldn't split an otherwise-identical issue into two fingerprints
    .replace(/\b[0-9a-f]{7,40}\b/g, '<hash>') // commit/object hashes
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, '<timestamp>')
    .replace(/:\d+:\d+/g, ':<line>:<col>') // line:col positions
    .replace(/:\d+\)/g, ':<line>)')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Content-hash dedup key. Same {source, subsystem, normalized message} always yields the same
 * fingerprint, regardless of exact timestamps/line numbers/hashes in the raw text — this is what
 * lets a TypeScript error and a later identical browser runtime error (or a re-run of the same
 * broken build) collapse into one issue instead of spawning duplicates.
 */
export function fingerprintIssue(input: Pick<NativeIssueIngestInput, 'source' | 'affectedSubsystem' | 'rawEvidenceText'>): string {
  const normalized = normalizeForFingerprint(input.rawEvidenceText)
  const key = `${input.source}::${input.affectedSubsystem.toLowerCase().trim()}::${normalized}`
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32)
}

/** Builds a brand-new issue record (first sighting). Caller (storage.ts) decides whether an
 * existing record with the same fingerprint should absorb this instead via mergeIssueOccurrence. */
export function ingestIssue(input: NativeIssueIngestInput, id: string, now: string): NativeIssueRecord {
  return {
    id,
    fingerprint: fingerprintIssue(input),
    title: input.title,
    severity: input.severity,
    source: input.source,
    affectedSubsystem: input.affectedSubsystem,
    evidence: input.evidence,
    rawEvidenceText: input.rawEvidenceText,
    occurrenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
  }
}

/** Pure merge: same fingerprint recurring bumps occurrence count and freshens evidence/severity
 * (never downgrades severity on a repeat) without creating a second record. Never mutates inputs. */
export function mergeIssueOccurrence(existing: NativeIssueRecord, incoming: NativeIssueIngestInput, now: string): NativeIssueRecord {
  const severityRank: Record<NativeIssueRecord['severity'], number> = { high: 0, medium: 1, low: 2 }
  const severity = severityRank[incoming.severity] < severityRank[existing.severity] ? incoming.severity : existing.severity
  const evidence = [...new Set([...existing.evidence, ...incoming.evidence])].slice(0, 20)
  return {
    ...existing,
    severity,
    evidence,
    occurrenceCount: existing.occurrenceCount + 1,
    lastSeenAt: now,
    // A recurring issue is not resolved — reopen so the badge stays truthful.
    status: existing.status === 'resolved' ? 'open' : existing.status,
    resolvedAt: existing.status === 'resolved' ? undefined : existing.resolvedAt,
    resolvedByRepairId: existing.status === 'resolved' ? undefined : existing.resolvedByRepairId,
  }
}

// --- Source-specific builders — each just shapes a NativeIssueIngestInput; no I/O. -----------

export function issueFromPanelErrorBoundary(args: {
  panelLabel: string
  errorMessage: string
  componentStack?: string
}): NativeIssueIngestInput {
  return {
    source: 'panel_error_boundary',
    title: `Panel "${args.panelLabel}" failed to render`,
    severity: 'high',
    affectedSubsystem: args.panelLabel,
    evidence: [args.errorMessage, ...(args.componentStack ? [args.componentStack.split('\n').slice(0, 3).join('\n')] : [])],
    rawEvidenceText: `${args.panelLabel}: ${args.errorMessage}`,
  }
}

export function issueFromBrowserRuntimeError(args: {
  message: string
  source?: string
  stack?: string
  subsystem?: string
}): NativeIssueIngestInput {
  return {
    source: 'browser_runtime_error',
    title: args.message.slice(0, 140),
    severity: 'medium',
    affectedSubsystem: args.subsystem ?? args.source ?? 'unknown',
    evidence: [args.message, ...(args.stack ? [args.stack.split('\n').slice(0, 5).join('\n')] : [])],
    rawEvidenceText: `${args.source ?? ''} ${args.message} ${args.stack ?? ''}`.trim(),
  }
}

export function issueFromTypeScriptFailure(args: { file: string; message: string }): NativeIssueIngestInput {
  return {
    source: 'typescript',
    title: `TypeScript error in ${args.file}`,
    severity: 'high',
    affectedSubsystem: args.file,
    evidence: [args.message],
    rawEvidenceText: `${args.file}: ${args.message}`,
  }
}

export function issueFromEslintFailure(args: { file: string; ruleId: string; message: string }): NativeIssueIngestInput {
  return {
    source: 'eslint',
    title: `ESLint ${args.ruleId} in ${args.file}`,
    severity: 'medium',
    affectedSubsystem: args.file,
    evidence: [args.message],
    rawEvidenceText: `${args.file}: ${args.ruleId}: ${args.message}`,
  }
}

export function issueFromBuildFailure(args: { message: string; subsystem?: string }): NativeIssueIngestInput {
  return {
    source: 'build',
    title: 'Production build failed',
    severity: 'high',
    affectedSubsystem: args.subsystem ?? 'build',
    evidence: [args.message],
    rawEvidenceText: args.message,
  }
}

export function issueFromTestFailure(args: { testName: string; message: string; subsystem?: string }): NativeIssueIngestInput {
  return {
    source: 'test',
    title: `Test failed: ${args.testName}`,
    severity: 'medium',
    affectedSubsystem: args.subsystem ?? args.testName,
    evidence: [args.message],
    rawEvidenceText: `${args.testName}: ${args.message}`,
  }
}

export function issueFromCommanderReport(args: {
  title: string
  description: string
  subsystem: string
  severity?: NativeIssueIngestInput['severity']
}): NativeIssueIngestInput {
  return {
    source: 'commander_report',
    title: args.title,
    severity: args.severity ?? 'medium',
    affectedSubsystem: args.subsystem,
    evidence: [args.description],
    rawEvidenceText: `${args.title}: ${args.description}`,
  }
}

/** Feeds the [REPAIR SYSTEM] sweep — one canonical System Health check (degraded/unavailable/
 * unknown) becomes one issue, so it flows through the same fingerprint/dedup/repair pipeline as
 * every other issue source rather than a separate ad hoc "fix this subsystem" path. */
export function issueFromSystemHealthCheck(check: {
  subsystemId: string
  title: string
  status: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  evidenceLabels: string[]
}): NativeIssueIngestInput {
  const severity: NativeIssueIngestInput['severity'] =
    check.severity === 'critical' || check.severity === 'high' ? 'high' : check.severity === 'info' ? 'low' : check.severity
  return {
    source: 'system_health',
    title: `${check.title} is ${check.status}`,
    severity,
    affectedSubsystem: check.subsystemId,
    evidence: check.evidenceLabels,
    rawEvidenceText: `${check.subsystemId}: ${check.status} — ${check.evidenceLabels.join('; ')}`,
  }
}
