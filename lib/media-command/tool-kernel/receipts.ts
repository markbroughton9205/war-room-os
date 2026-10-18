import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mediaCommandDataHierarchy } from '../paths'
import { safeFsId } from '../jobs'
import type { HvsReceiptStatus, HvsToolName, HvsToolReceipt } from './types'

export function kernelReceiptsDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().jobs, safeFsId(projectId, 'project'), 'kernel')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function newKernelJobId(): string {
  return `hvsjob-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

export function hashToolArgs(tool: string, input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({ tool, input }), 'utf8').digest('hex')
}

export function receiptPath(projectId: string, jobId: string): string {
  return path.join(kernelReceiptsDir(projectId), `${safeFsId(jobId, 'job')}.json`)
}

export function startReceipt(input: {
  toolName: HvsToolName | string
  missionId?: string | null
  projectId?: string | null
  args: Record<string, unknown>
  jobId?: string
}): HvsToolReceipt {
  const startedAt = new Date().toISOString()
  return {
    schema: 'hvs.receipt.v1',
    jobId: input.jobId ?? newKernelJobId(),
    missionId: input.missionId ?? null,
    projectId: input.projectId ?? null,
    toolName: input.toolName,
    argumentsHash: hashToolArgs(input.toolName, input.args),
    startedAt,
    completedAt: null,
    status: 'RUNNING',
    outputAssetRefs: [],
    hashes: { arguments: hashToolArgs(input.toolName, input.args) },
    qcState: 'NOT_RUN',
    errors: [],
    authorityClass: 'LOCAL_MEDIA',
    editOp: null,
  }
}

export function finishReceipt(
  receipt: HvsToolReceipt,
  patch: Partial<HvsToolReceipt> & { status: HvsReceiptStatus },
): HvsToolReceipt {
  const next: HvsToolReceipt = {
    ...receipt,
    ...patch,
    completedAt: patch.completedAt ?? new Date().toISOString(),
    errors: patch.errors ?? receipt.errors,
  }
  persistReceipt(next)
  return next
}

export function persistReceipt(receipt: HvsToolReceipt): void {
  const projectId = receipt.projectId ?? '_unscoped'
  writeFileSync(receiptPath(projectId, receipt.jobId), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

export function loadReceipt(projectId: string, jobId: string): HvsToolReceipt | null {
  const file = receiptPath(projectId, jobId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as HvsToolReceipt
  } catch {
    return null
  }
}

export function listReceipts(projectId: string): HvsToolReceipt[] {
  const dir = kernelReceiptsDir(projectId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try {
        return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as HvsToolReceipt
      } catch {
        return null
      }
    })
    .filter((row): row is HvsToolReceipt => Boolean(row))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function findIdempotentReceipt(projectId: string, argumentsHash: string, toolName: string): HvsToolReceipt | null {
  return listReceipts(projectId).find(row =>
    row.toolName === toolName
    && row.argumentsHash === argumentsHash
    && row.status === 'COMPLETED',
  ) ?? null
}
