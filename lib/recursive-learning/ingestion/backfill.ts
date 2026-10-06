import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { LearningLog } from '../store'
import type { EvaluationEventInput } from '../types'
import { missionToEvents } from './missionAdapter'
import { recordIngestionFailure } from './failureLog'

const MISSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/
const MAX_FILE_BYTES = 8 * 1024 * 1024

export type BackfillOptions = {
  missionsDir: string
  log: LearningLog
  /** Hard cap on mission files examined (bounded run). */
  limit?: number
  includeClassifications?: string[]
  /** Optional audit JSONL to count (never convert) unattributable rollback receipts. */
  auditFile?: string
  /** Default true: report what would be ingested without writing. */
  dryRun?: boolean
  now?: Date
}
export type BackfillReport = {
  dryRun: boolean
  filesExamined: number
  limitReached: boolean
  eventsProposed: number
  inserted: number
  duplicates: number
  rejected: number
  skippedByReason: Record<string, number>
  unreadable: number
  unattributableRollbackReceipts: number
}

/**
 * Explicit, bounded, rerunnable backfill from durable Foundry mission records. Reads source files only (never writes
 * to them). Events carry backfilled=true and the source path; ids are stable so reruns insert nothing new.
 */
export async function backfillFoundryMissions(opts: BackfillOptions): Promise<BackfillReport> {
  const dryRun = opts.dryRun ?? true
  const limit = opts.limit ?? 2000
  const names = (await readdir(opts.missionsDir)).filter((n) => MISSION_FILE.test(n)).sort()
  const report: BackfillReport = { dryRun, filesExamined: 0, limitReached: names.length > limit, eventsProposed: 0, inserted: 0, duplicates: 0, rejected: 0, skippedByReason: {}, unreadable: 0, unattributableRollbackReceipts: 0 }
  const proposed: EvaluationEventInput[] = []
  for (const name of names.slice(0, limit)) {
    report.filesExamined += 1
    const file = path.join(opts.missionsDir, name)
    try {
      if ((await stat(file)).size > MAX_FILE_BYTES) throw new Error('file_too_large')
      const res = missionToEvents(JSON.parse(await readFile(file, 'utf8')), { backfilled: true, sourcePath: `foundry-missions/${name}`, includeClassifications: opts.includeClassifications })
      if (res.skipped) report.skippedByReason[res.skipped] = (report.skippedByReason[res.skipped] ?? 0) + 1
      proposed.push(...res.events)
    } catch (err) {
      report.unreadable += 1
      recordIngestionFailure('backfill-foundry-mission', name, `unreadable: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }
  report.eventsProposed = proposed.length
  if (opts.auditFile && existsSync(opts.auditFile)) {
    const rl = createInterface({ input: createReadStream(opts.auditFile, 'utf8'), crlfDelay: Infinity })
    for await (const line of rl) if (/"message":"[^"]*rollback/i.test(line)) report.unattributableRollbackReceipts += 1
  }
  if (dryRun) {
    const known = new Set(opts.log.view().events.map((e) => e.id))
    report.duplicates = proposed.filter((e) => e.id && known.has(e.id)).length
    return report
  }
  const res = opts.log.recordEvents(proposed, opts.now)
  report.inserted = res.inserted.length
  report.duplicates = res.duplicates
  report.rejected = res.rejected.length
  return report
}
