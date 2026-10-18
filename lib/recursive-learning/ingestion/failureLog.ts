import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { learningDir } from '../paths'

/** Honest record of ingestion problems. Holds reasons and identifiers only, never source content. */
export function recordIngestionFailure(adapter: string, sourceId: string, reason: string, dir: string = learningDir()): void {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'ingestion-failures.jsonl'), JSON.stringify({ at: new Date().toISOString(), adapter, sourceId: sourceId.slice(0, 120), reason: reason.slice(0, 200) }) + '\n', 'utf8')
  } catch {
    // failure to record a failure must never propagate into mission flow
  }
}
