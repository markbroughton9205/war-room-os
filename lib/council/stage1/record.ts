/**
 * Durable Stage 1 turn record (stored in the owner's conversation metadata, last N turns).
 * Pure merge logic lives here so it is testable without a database.
 */
import type { Contribution, Stage1Attribution } from './attribution'
import type { CoordinatorDecision, Stage1Status, TurnUnderstanding } from './types'

export const STAGE1_METADATA_KEY = 'councilStage1'
export const STAGE1_MAX_TURNS = 40

export type Stage1ResearchRecord = {
  mode: string
  sourcesCount: number
  label: string
  accepted: number | null
  considered: number | null
  rejected: number | null
  sources: Array<{ url: string | null; title: string; evidenceLabel: string; accepted: boolean }>
  unknowns: string[]
}

export type Stage1TurnRecord = {
  turnId: string
  at: string
  decree: string
  responsePreview: string
  mode: string | null
  status: Stage1Status
  statusReason: string
  understanding: Pick<TurnUnderstanding, 'act' | 'topics' | 'references' | 'correction' | 'continuation' | 'normalizationNotes' | 'executionRequested'>
  decision: Pick<CoordinatorDecision, 'route' | 'complexity' | 'members' | 'excluded' | 'reasons' | 'externalResearch' | 'serializeHeavyLocal'>
  contributions: Contribution[]
  sharedModelNote: string | null
  responder: { kind: 'deterministic' | 'model'; label: string; model: string | null } | null
  research: Stage1ResearchRecord | null
  localKnowledge: Array<{ id: string; status: string; source: string }>
}

export type Stage1Metadata = { version: 1; updatedAt: string; turns: Stage1TurnRecord[] }

function key(c: Contribution): string {
  return `${c.member.toUpperCase()}|${c.role}`
}

/** Per-family continuation calls share a turnId; merge their contributions rather than overwrite. */
export function mergeTurnRecord(prev: Stage1TurnRecord | undefined, next: Stage1TurnRecord): Stage1TurnRecord {
  if (!prev) return next
  const byKey = new Map<string, Contribution>()
  for (const c of prev.contributions) byKey.set(key(c), c)
  for (const c of next.contributions) byKey.set(key(c), c)
  const contributions = Array.from(byKey.values()).sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i + 1 }))
  const ok = contributions.filter(c => c.status === 'COMPLETED').length
  const status: Stage1Status = next.status === 'WAITING' || next.status === 'CANCELLED' || next.status === 'INTERRUPTED'
    ? next.status
    : contributions.length === 0 ? next.status : ok === contributions.length ? 'COMPLETED' : ok === 0 ? 'FAILED' : 'PARTIAL'
  return {
    ...next,
    contributions,
    status,
    statusReason: contributions.length ? `${ok} of ${contributions.length} contribution(s) completed` : next.statusReason,
    research: next.research ?? prev.research,
    responsePreview: next.responsePreview || prev.responsePreview,
  }
}

export function upsertTurn(meta: Stage1Metadata | null, rec: Stage1TurnRecord, now = new Date().toISOString()): Stage1Metadata {
  const turns = [...(meta?.turns ?? [])]
  const i = turns.findIndex(t => t.turnId === rec.turnId)
  if (i >= 0) turns[i] = mergeTurnRecord(turns[i], rec)
  else turns.push(rec)
  return { version: 1, updatedAt: now, turns: turns.slice(-STAGE1_MAX_TURNS) }
}

export function readStage1Metadata(metadata: unknown): Stage1Metadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>)[STAGE1_METADATA_KEY]
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<Stage1Metadata>
  if (m.version !== 1 || !Array.isArray(m.turns)) return null
  return { version: 1, updatedAt: String(m.updatedAt ?? ''), turns: m.turns as Stage1TurnRecord[] }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function buildTurnRecord(input: {
  turnId: string
  decree: string
  responseText: string
  mode: string | null
  understanding: TurnUnderstanding
  decision: CoordinatorDecision
  attribution: Stage1Attribution | null
  selfStatus?: Stage1Status
  responder?: Stage1TurnRecord['responder']
  research?: Stage1ResearchRecord | null
  localKnowledge?: Stage1TurnRecord['localKnowledge']
  now?: string
}): Stage1TurnRecord {
  const a = input.attribution
  const u = input.understanding
  return {
    turnId: input.turnId,
    at: input.now ?? new Date().toISOString(),
    decree: clip(input.decree, 400),
    responsePreview: clip(input.responseText, 300),
    mode: input.mode,
    status: input.selfStatus ?? a?.status ?? 'FAILED',
    statusReason: input.selfStatus ? 'answered deterministically by Stage 1' : a?.statusReason ?? 'no attribution available',
    understanding: {
      act: u.act, topics: u.topics, references: u.references, correction: u.correction,
      continuation: u.continuation, normalizationNotes: u.normalizationNotes, executionRequested: u.executionRequested,
    },
    decision: {
      route: input.decision.route, complexity: input.decision.complexity, members: input.decision.members,
      excluded: input.decision.excluded, reasons: input.decision.reasons,
      externalResearch: input.decision.externalResearch, serializeHeavyLocal: input.decision.serializeHeavyLocal,
    },
    contributions: a?.contributions ?? [],
    sharedModelNote: a?.sharedModelNote ?? null,
    responder: input.responder ?? null,
    research: input.research ?? null,
    localKnowledge: input.localKnowledge ?? [],
  }
}
