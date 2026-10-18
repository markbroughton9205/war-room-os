/**
 * Shared HVS job envelope. Wraps ProviderJob / RenderJob / AnalysisJob.
 * COMPLETED is only written when the required real result exists on disk.
 * Jobs persist under media-command/jobs/{projectId}/{jobId}.json — not SQL.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { assertNoSecrets, stripSecrets, containsSecretValue } from './secrets'

export const HVS_JOB_SCHEMA = 1 as const

export type HvsJobKind = 'provider' | 'analysis' | 'render' | 'vfx' | 'color' | 'audio' | 'qc'

export type HvsJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED'
  | 'BLOCKED_PENDING_APPROVAL'

export type HvsJobAuthority = {
  spend: boolean
  externalUpload: boolean
  sensitiveTransfer: boolean
}

export type HvsJobRetry = {
  attempt: number
  maxAttempts: number
  lastError: string | null
  retryable: boolean
  nextRetryAt: string | null
}

export type HvsJobMetrics = {
  queuedAt?: string
  startedAt?: string
  queueDurationMs?: number | null
  executionDurationMs?: number | null
  cacheHit?: boolean
  cacheMiss?: boolean
  peakMemoryBytes?: number | null
  gpuMemoryBytes?: number | null
}

export type HvsJobProvenance = {
  backend: string
  capability?: string | null
  createdBy: 'human' | 'ai-director' | 'system'
  notes?: string
}

export type HvsJob = {
  schemaVersion: typeof HVS_JOB_SCHEMA
  id: string
  kind: HvsJobKind
  status: HvsJobStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  projectId: string
  versionId: string | null
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  backend: string
  parameters: Record<string, unknown>
  error: string | null
  retry: HvsJobRetry
  provenance: HvsJobProvenance
  authority: HvsJobAuthority
  metrics: HvsJobMetrics
  cancelRequested: boolean
}

export const JOB_RECOVERY_POLICY = `
JOB RECOVERY POLICY
- QUEUED jobs remain QUEUED after process restart. They are not auto-started.
- RUNNING jobs that survive a crash are marked FAILED with error INTERRUPTED.
  They are not marked COMPLETED. Resume is only allowed when the backend
  explicitly supports resume (none do in Wave 1).
- CANCELLED, FAILED, BLOCKED, BLOCKED_PENDING_APPROVAL, COMPLETED are terminal
  except retry which creates a new attempt metadata on the same id only when
  retryable && !authority.spend.
- Paid/metered work is never auto-retried.
`.trim()

const ID_OK = /^[a-zA-Z0-9._-]+$/

export function safeFsId(id: string, label: string): string {
  if (!id || !ID_OK.test(id) || id.includes('..')) {
    throw new Error(`Unsafe ${label} id.`)
  }
  return id
}

export function jobsDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().jobs, safeFsId(projectId, 'project'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function jobFilePath(projectId: string, jobId: string): string {
  return path.join(jobsDir(projectId), `${safeFsId(jobId, 'job')}.json`)
}

export function newJobId(prefix = 'hjob'): string {
  let id = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  let guard = 0
  while (containsSecretValue(id) && guard++ < 8) {
    id = `${prefix}-${Date.now().toString(36)}${guard}-${Math.random().toString(36).slice(2, 10)}`
  }
  return id
}

export function emptyRetry(): HvsJobRetry {
  return { attempt: 1, maxAttempts: 1, lastError: null, retryable: false, nextRetryAt: null }
}

export function createHvsJob(input: {
  kind: HvsJobKind
  projectId: string
  versionId?: string | null
  backend: string
  inputs?: Record<string, unknown>
  parameters?: Record<string, unknown>
  authority?: Partial<HvsJobAuthority>
  provenance?: Partial<HvsJobProvenance>
  status?: HvsJobStatus
  id?: string
}): HvsJob {
  const now = new Date().toISOString()
  const job: HvsJob = {
    schemaVersion: HVS_JOB_SCHEMA,
    id: input.id ?? newJobId(),
    kind: input.kind,
    status: input.status ?? 'QUEUED',
    createdAt: now,
    startedAt: null,
    completedAt: null,
    projectId: input.projectId,
    versionId: input.versionId ?? null,
    inputs: stripSecrets(input.inputs ?? {}),
    outputs: {},
    backend: input.backend,
    parameters: stripSecrets(input.parameters ?? {}),
    error: null,
    retry: emptyRetry(),
    provenance: {
      backend: input.backend,
      createdBy: input.provenance?.createdBy ?? 'system',
      capability: input.provenance?.capability ?? null,
      notes: input.provenance?.notes,
    },
    authority: {
      spend: Boolean(input.authority?.spend),
      externalUpload: Boolean(input.authority?.externalUpload),
      sensitiveTransfer: Boolean(input.authority?.sensitiveTransfer),
    },
    metrics: { queuedAt: now, queueDurationMs: null, executionDurationMs: null },
    cancelRequested: false,
  }
  assertNoSecrets(job, 'HvsJob')
  return job
}

function atomicWrite(file: string, body: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, file)
}

export function saveJob(job: HvsJob): HvsJob {
  const clean = stripSecrets(job)
  assertNoSecrets(clean, 'HvsJob')
  atomicWrite(jobFilePath(clean.projectId, clean.id), `${JSON.stringify(clean, null, 2)}\n`)
  return clean
}

export async function loadJob(projectId: string, jobId: string): Promise<HvsJob | null> {
  const file = jobFilePath(projectId, jobId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as HvsJob
  } catch {
    return null
  }
}

export function listJobs(projectId: string): HvsJob[] {
  const dir = jobsDir(projectId)
  const rows: HvsJob[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as HvsJob
      if (raw?.id && raw.projectId === projectId) rows.push(raw)
    } catch {
      // Isolation: a corrupt job file must not break the project.
    }
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function requiredResultExists(job: HvsJob): boolean {
  if (job.kind === 'provider') {
    const artifact = typeof job.outputs.artifactPath === 'string' ? job.outputs.artifactPath : null
    return Boolean(artifact && existsSync(artifact))
  }
  if (job.kind === 'analysis') {
    const file = typeof job.outputs.observationsPath === 'string' ? job.outputs.observationsPath
      : typeof job.outputs.transcriptPath === 'string' ? job.outputs.transcriptPath
      : null
    return Boolean(file && existsSync(file))
  }
  if (job.kind === 'render') {
    const file = typeof job.outputs.outputPath === 'string' ? job.outputs.outputPath : null
    return Boolean(file && existsSync(file))
  }
  if (job.kind === 'vfx' || job.kind === 'color' || job.kind === 'audio' || job.kind === 'qc') {
    const file = typeof job.outputs.outputPath === 'string' ? job.outputs.outputPath : null
    if (file) return existsSync(file)
    return job.outputs.validState === true
  }
  return false
}

export function markJobRunning(job: HvsJob): HvsJob {
  if (job.cancelRequested) return { ...job, status: 'CANCELLED', error: 'Cancelled before start.', completedAt: new Date().toISOString() }
  const now = new Date().toISOString()
  const queuedAt = job.metrics.queuedAt ?? job.createdAt
  const queueDurationMs = Math.max(0, Date.parse(now) - Date.parse(queuedAt))
  return saveJob({
    ...job,
    status: 'RUNNING',
    startedAt: now,
    metrics: { ...job.metrics, startedAt: now, queueDurationMs },
  })
}

export function markJobCompleted(job: HvsJob, outputs: Record<string, unknown>): HvsJob {
  const next: HvsJob = {
    ...job,
    outputs: stripSecrets({ ...job.outputs, ...outputs }),
    status: job.status,
  }
  if (!requiredResultExists(next)) {
    return saveJob({
      ...next,
      status: 'FAILED',
      error: 'COMPLETED refused: required result is missing.',
      completedAt: new Date().toISOString(),
    })
  }
  const now = new Date().toISOString()
  const started = job.startedAt ?? job.createdAt
  return saveJob({
    ...next,
    status: 'COMPLETED',
    completedAt: now,
    error: null,
    metrics: {
      ...job.metrics,
      executionDurationMs: Math.max(0, Date.parse(now) - Date.parse(started)),
    },
  })
}

export function markJobFailed(job: HvsJob, error: string): HvsJob {
  return saveJob({
    ...job,
    status: 'FAILED',
    error,
    completedAt: new Date().toISOString(),
    retry: { ...job.retry, lastError: error },
  })
}

export function requestCancel(job: HvsJob): HvsJob {
  if (job.status === 'COMPLETED' || job.status === 'CANCELLED') return job
  const next: HvsJob = {
    ...job,
    cancelRequested: true,
    status: job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'BLOCKED' || job.status === 'BLOCKED_PENDING_APPROVAL'
      ? 'CANCELLED'
      : job.status,
    completedAt: new Date().toISOString(),
    error: job.status === 'RUNNING' ? 'Cancel requested; existing outputs preserved; originals untouched.' : job.error,
  }
  return saveJob(next)
}

export function retryJob(job: HvsJob, now = new Date().toISOString()): HvsJob {
  if (job.authority.spend) {
    return saveJob({
      ...job,
      status: 'BLOCKED_PENDING_APPROVAL',
      error: 'Paid retry requires Commander authority.',
      retry: { ...job.retry, retryable: false, lastError: 'spend-retry-forbidden' },
    })
  }
  if (!job.retry.retryable || job.retry.attempt >= job.retry.maxAttempts) {
    return saveJob({
      ...job,
      status: 'FAILED',
      error: job.error ?? 'Retry exhausted.',
      retry: { ...job.retry, retryable: false },
    })
  }
  return saveJob({
    ...job,
    status: 'QUEUED',
    startedAt: null,
    completedAt: null,
    error: null,
    retry: {
      ...job.retry,
      attempt: job.retry.attempt + 1,
      lastError: job.error,
      nextRetryAt: now,
    },
  })
}

export function recoverInterruptedJobs(projectId: string): HvsJob[] {
  const recovered: HvsJob[] = []
  for (const job of listJobs(projectId)) {
    if (job.status === 'RUNNING') {
      recovered.push(markJobFailed(job, 'INTERRUPTED: process stopped while RUNNING. Not completed. Resume unsupported in Wave 1.'))
    }
  }
  return recovered
}

export function deleteJobFileForTests(projectId: string, jobId: string): void {
  const file = jobFilePath(projectId, jobId)
  if (existsSync(file)) unlinkSync(file)
}
