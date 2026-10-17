import { TERMINAL_COMMAND_STATES, type Cause, type CommandRecord } from './types'

/**
 * Measured autonomy: computed from the durable command records, nothing estimated. A command is "autonomous" when it ended DELIVERED and the Commander did nothing to it after
 * typing it (no continue, restart, pause, resume or cancel). Recoveries are the failures Foundry diagnosed and got past by itself.
 */
export type AutonomyMetrics = {
  commands: number; finished: number; delivered: number; blocked: number; failed: number; cancelled: number
  /** delivered without any Commander action / (finished commands the Commander did not cancel) */
  autonomousCompletionRate: number | null
  deliveredAfterRecovery: number
  interventions: { kind: string; count: number }[]
  failuresDiagnosed: number
  failuresRecovered: number
  byCause: Record<string, { diagnosed: number; recovered: number }>
  escalations: { local: number; localSucceeded: number }
  meanMinutesToDelivery: number | null
  /** why commands ended BLOCKED/FAILED: the remaining reasons a person had to look */
  remainingInterventionCauses: { commandId: string; cause: string; reason: string }[]
}

const COMMANDER_KINDS = new Set(['REOPENED', 'PAUSE', 'RESUME', 'RESTARTED'])
export function autonomyMetrics(all: CommandRecord[]): AutonomyMetrics {
  const finished = all.filter((c) => TERMINAL_COMMAND_STATES.includes(c.state))
  const intervened = (c: CommandRecord) => c.timeline.some((t) => COMMANDER_KINDS.has(t.kind)) || c.state === 'CANCELLED'
  const delivered = finished.filter((c) => c.state === 'DELIVERED')
  const auto = delivered.filter((c) => !intervened(c))
  const denom = finished.filter((c) => c.state !== 'CANCELLED').length
  const byCause: AutonomyMetrics['byCause'] = {}
  let diagnosed = 0, recovered = 0, escL = 0, escOk = 0
  for (const c of all) for (const list of Object.values(c.diagnoses ?? {})) for (const d of list) {
    diagnosed++; const e = (byCause[d.cause] ??= { diagnosed: 0, recovered: 0 }); e.diagnosed++
    if (c.state === 'DELIVERED') { recovered++; e.recovered++ }
  }
  for (const c of all) for (const dec of c.decisions ?? []) if (dec.chosen.startsWith('escalate to the local specialist')) { escL++; if (c.state === 'DELIVERED') escOk++ }
  const kinds = new Map<string, number>()
  for (const c of finished) for (const t of c.timeline) if (COMMANDER_KINDS.has(t.kind)) kinds.set(t.kind, (kinds.get(t.kind) ?? 0) + 1)
  const mins = delivered.map((c) => { const end = [...c.timeline].reverse().find((t) => t.kind === 'DELIVERED')?.at; return end ? (Date.parse(end) - Date.parse(c.createdAt)) / 60_000 : null }).filter((x): x is number => x !== null)
  return {
    commands: all.length, finished: finished.length, delivered: delivered.length, blocked: finished.filter((c) => c.state === 'BLOCKED').length, failed: finished.filter((c) => c.state === 'FAILED').length, cancelled: finished.filter((c) => c.state === 'CANCELLED').length,
    autonomousCompletionRate: denom ? Math.round((auto.length / denom) * 1000) / 1000 : null,
    deliveredAfterRecovery: delivered.filter((c) => Object.values(c.diagnoses ?? {}).some((l) => l.length)).length,
    interventions: [...kinds.entries()].map(([kind, count]) => ({ kind, count })),
    failuresDiagnosed: diagnosed, failuresRecovered: recovered, byCause, escalations: { local: escL, localSucceeded: escOk },
    meanMinutesToDelivery: mins.length ? Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) / 10 : null,
    remainingInterventionCauses: finished.filter((c) => c.state === 'BLOCKED' || c.state === 'FAILED').map((c) => { const last = Object.values(c.diagnoses ?? {}).flat().at(-1); return { commandId: c.id, cause: (last?.cause ?? 'unknown') as Cause | string, reason: c.stateReason.slice(0, 240) } }),
  }
}
