import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createEvaluationEvent } from './eventModel'
import type { Decision, EvaluationEvent, EvaluationEventInput, LogRecord, Proposal } from './types'

export type LogView = {
  events: EvaluationEvent[]
  activeEvents: EvaluationEvent[]
  supersessions: Extract<LogRecord, { t: 'supersede' }>[]
  proposals: Proposal[]
  decisions: Decision[]
  promotions: Extract<LogRecord, { t: 'promotion' }>[]
}

/**
 * Append-only JSONL log. Nothing is ever rewritten or deleted: supersession and decisions are
 * additional records. State survives restart because it is re-derived from the file.
 */
export class LearningLog {
  readonly file: string
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'recursive-learning.jsonl')
  }

  append(record: LogRecord): void {
    appendFileSync(this.file, JSON.stringify(record) + '\n', 'utf8')
  }

  recordEvent(input: EvaluationEventInput, now: Date = new Date()): EvaluationEvent {
    const event = createEvaluationEvent(input, now)
    if (this.view().events.some((e) => e.id === event.id)) throw new Error(`duplicate event id: ${event.id}`)
    this.append({ t: 'event', event })
    return event
  }

  /** Marks evidence as superseded (excluded from scoring) while keeping it retrievable. */
  supersede(eventId: string, reason: string, supersededBy?: string, now: Date = new Date()): void {
    const v = this.view()
    if (!v.events.some((e) => e.id === eventId)) throw new Error(`unknown event: ${eventId}`)
    if (supersededBy && !v.events.some((e) => e.id === supersededBy)) throw new Error(`unknown superseding event: ${supersededBy}`)
    if (!reason.trim()) throw new Error('supersede reason required')
    this.append({ t: 'supersede', eventId, supersededBy, reason, at: now.toISOString() })
  }

  view(): LogView {
    const events: EvaluationEvent[] = []
    const supersessions: LogView['supersessions'] = []
    const proposals: Proposal[] = []
    const decisions: Decision[] = []
    const promotions: LogView['promotions'] = []
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const rec = JSON.parse(line) as LogRecord
        if (rec.t === 'event') events.push(rec.event)
        else if (rec.t === 'supersede') supersessions.push(rec)
        else if (rec.t === 'proposal') proposals.push(rec.proposal)
        else if (rec.t === 'decision') decisions.push(rec.decision)
        else if (rec.t === 'promotion') promotions.push(rec)
      }
    }
    const gone = new Set(supersessions.map((s) => s.eventId))
    return { events, activeEvents: events.filter((e) => !gone.has(e.id)), supersessions, proposals, decisions, promotions }
  }
}
