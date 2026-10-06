import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LearningLog } from './store'
import type { EvaluationEventInput, TaskClass } from './types'

export type Result = { name: string; pass: boolean; detail: string }
export function harness(label: string) {
  const results: Result[] = []
  return {
    check(name: string, pass: boolean, detail = '') { results.push({ name, pass, detail }) },
    finish(): never {
      for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' ' + r.detail : ''}`)
      const failed = results.filter((r) => !r.pass).length
      console.log(failed === 0 ? `${label} PASS` : `${label} FAIL (${failed})`)
      process.exit(failed === 0 ? 0 : 1)
    },
  }
}
export const NOW = new Date('2026-10-06T00:00:00.000Z')
export const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
export const tmpDir = (p = 'p9-') => mkdtempSync(path.join(tmpdir(), p))
export const freshLog = () => new LearningLog(tmpDir())
let seq = 0
export function ev(provider: string, taskClass: TaskClass, outcome: EvaluationEventInput['outcome'], ageDays: number, extra: Partial<EvaluationEventInput> = {}): EvaluationEventInput {
  seq += 1
  return { id: `t${seq}-${provider}`, subject: { kind: 'provider', id: provider }, taskClass, outcome, occurredAt: day(ageDays), source: { kind: 'test', ref: `fixture-${seq}` }, ...extra }
}

/** Deterministic Foundry-shaped mission record for adapter/backfill tests. */
export function missionFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  const id = String(over.missionId ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`)
  return {
    missionId: id, title: 't', userRequest: 'r', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:30:00.000Z',
    status: 'COMPLETE', phase: 'COMPLETE', kind: 'application', classification: 'COMMANDER_REAL',
    interpretation: { locateOnly: false },
    modelState: { activeProvider: 'ollama', activeModel: 'qwen2.5-coder:14b', primaryProvider: 'ollama', calls: 9 },
    testState: { ok: true }, buildState: { ok: true }, packageState: { ok: null }, installState: { ok: null },
    retryCounts: {}, errors: [], toolCalls: [], authorization: null,
    journal: [
      { at: '2026-09-20T10:00:00.000Z', kind: 'decision', text: 'Mission created.' },
      { at: '2026-09-20T10:30:00.000Z', kind: 'transition', text: 'VERIFYING → COMPLETE: done' },
    ],
    ...over,
  }
}
