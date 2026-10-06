/**
 * Bounded, secret-free generation receipts under the existing per-project directory:
 *   media-command/projects/<projectId>/generations/<generationId>/receipt.json
 *   media-command/projects/<projectId>/generations/receipts.jsonl  (append-only index, one line per terminal state)
 * Receipts are evidence, not project truth. The .hvsproj only gains the ingested AssetRecord.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { safeFsId } from '../jobs'
import { assertNoSecrets, stripSecrets } from '../secrets'
import type { HvsGenerationErrorCode, HvsGenerationSettings, HvsGenerationStatus } from './types'

export type HvsGenerationReceipt = {
  schema: 'hvs.generation-receipt.v1'
  generationId: string
  projectId: string
  jobId: string | null
  provider: 'wan'
  model: string
  modelVersion: string | null
  capability: string
  status: HvsGenerationStatus
  requested: Partial<HvsGenerationSettings> | null
  actual: Partial<HvsGenerationSettings> | null
  seed: number | null
  promptHash: string | null
  promptPreview: string
  sourceImageAssetId: string | null
  outputAssetId: string | null
  outputPath: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  attempts: number
  errorCode: HvsGenerationErrorCode | null
  errorMessage: string | null
  localGeneration: true
  liveGeneration: boolean
  fixture: boolean
  network: 'none'
  workerLogTail: string
  gpu: { name: string | null; freeMiBAtAdmission: number | null; peakVramMiB: number | null } | null
}

export const RECEIPT_LOG_TAIL_MAX = 4 * 1024
export const RECEIPT_PROMPT_PREVIEW_MAX = 160

export function projectGenerationsDir(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, safeFsId(projectId, 'project'), 'generations')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function generationDir(projectId: string, generationId: string): string {
  const dir = path.join(projectGenerationsDir(projectId), safeFsId(generationId, 'generation'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function receiptPath(projectId: string, generationId: string): string {
  return path.join(generationDir(projectId, generationId), 'receipt.json')
}

export function writeGenerationReceipt(receipt: HvsGenerationReceipt): string {
  const bounded: HvsGenerationReceipt = stripSecrets({
    ...receipt,
    promptPreview: receipt.promptPreview.slice(0, RECEIPT_PROMPT_PREVIEW_MAX),
    errorMessage: receipt.errorMessage ? receipt.errorMessage.slice(0, 500) : null,
    workerLogTail: receipt.workerLogTail.slice(-RECEIPT_LOG_TAIL_MAX),
  })
  assertNoSecrets(bounded, 'HvsGenerationReceipt')
  const file = receiptPath(bounded.projectId, bounded.generationId)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(bounded, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  if (bounded.status === 'COMPLETE' || bounded.status === 'FAILED' || bounded.status === 'CANCELLED') {
    const line = JSON.stringify({
      generationId: bounded.generationId,
      status: bounded.status,
      outputAssetId: bounded.outputAssetId,
      errorCode: bounded.errorCode,
      completedAt: bounded.completedAt,
      liveGeneration: bounded.liveGeneration,
      fixture: bounded.fixture,
    })
    appendFileSync(path.join(projectGenerationsDir(bounded.projectId), 'receipts.jsonl'), `${line}\n`, 'utf8')
  }
  return file
}

export function readGenerationReceipt(projectId: string, generationId: string): HvsGenerationReceipt | null {
  try {
    const file = path.join(mediaCommandDataHierarchy().projects, safeFsId(projectId, 'project'), 'generations', safeFsId(generationId, 'generation'), 'receipt.json')
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as HvsGenerationReceipt
  } catch {
    return null
  }
}

export function listGenerationReceipts(projectId: string, limit = 20): Array<Record<string, unknown>> {
  try {
    const file = path.join(mediaCommandDataHierarchy().projects, safeFsId(projectId, 'project'), 'generations', 'receipts.jsonl')
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-Math.max(1, Math.min(limit, 200)))
    return lines.map(line => { try { return JSON.parse(line) as Record<string, unknown> } catch { return {} } }).reverse()
  } catch {
    return []
  }
}
