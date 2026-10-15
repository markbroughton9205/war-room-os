/**
 * Builds the honest per-turn attribution record from what actually happened in a Council
 * response (seat results + family-deliberation turns). Pure: takes the response payload,
 * returns only what the payload proves. Nothing is inferred about members that did not run.
 */
import { deriveTurnStatus } from './provenance'
import type { CoordinatorDecision, Stage1Status } from './types'

export type Contribution = {
  order: number
  member: string
  seat: string | null
  role: string
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'PARTIAL'
  model: string | null
  provider: string | null
  backendType: 'LOCAL' | 'EXTERNAL' | null
  latencyMs: number | null
  respondsTo: string[]
  agreements: string[]
  disagreements: string[]
  fallbackFrom: string | null
  failureReason: string | null
}

export type Stage1Attribution = {
  status: Stage1Status
  statusReason: string
  contributions: Contribution[]
  distinctModels: number
  sharedModelNote: string | null
  /** Members the coordinator selected that did not produce a contribution. */
  missingMembers: string[]
  externalSourcesConsulted: number
  toolsInvoked: string[]
}

type AnyRec = Record<string, unknown>
const rec = (v: unknown): AnyRec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function mapStatus(s: string | null): Contribution['status'] {
  const x = (s ?? '').toLowerCase()
  if (x === 'ok' || x === 'complete' || x === 'completed') return 'COMPLETED'
  if (x === 'timed_out') return 'TIMED_OUT'
  if (x === 'unavailable' || x === 'no_local_backend') return 'UNAVAILABLE'
  if (x === 'partial') return 'PARTIAL'
  return 'FAILED'
}

export function buildAttribution(payload: AnyRec, decision: CoordinatorDecision | null): Stage1Attribution {
  const contributions: Contribution[] = []
  const delib = rec(payload.familyDeliberation)
  const turns = arr(delib?.turns).map(rec).filter((t): t is AnyRec => t !== null)

  if (turns.length) {
    const idToMember = new Map<string, string>()
    for (const t of turns) {
      const out = str(t.output_message_id) ?? str(t.turn_id)
      if (out) idToMember.set(out, str(t.agent_identity) ?? str(t.provider_label) ?? 'UNKNOWN')
    }
    for (const t of turns) {
      const refs = [...arr(t.challenge_target_ids), ...arr(t.input_message_ids)].map(String)
      const respondsTo = Array.from(new Set(refs.map(r => idToMember.get(r)).filter((x): x is string => Boolean(x))))
      const member = str(t.agent_identity) ?? str(t.provider_label) ?? 'UNKNOWN'
      contributions.push({
        order: Number(t.speaking_order ?? contributions.length + 1),
        member,
        seat: str(t.provider_family),
        role: str(t.turn_role) ?? 'contribution',
        status: mapStatus(str(t.completion_status)),
        model: str(t.provider_model),
        provider: str(t.backend_provider),
        backendType: t.backend_type === 'LOCAL' || t.backend_type === 'EXTERNAL' ? t.backend_type : null,
        latencyMs: null,
        respondsTo: respondsTo.filter(r => r !== member),
        agreements: arr(t.direct_agreements).map(String).slice(0, 4),
        disagreements: arr(t.direct_disagreements).map(String).slice(0, 4),
        fallbackFrom: null,
        failureReason: str(t.failure_reason),
      })
    }
  } else {
    let order = 0
    for (const r of arr(payload.results).map(rec)) {
      if (!r) continue
      const b = rec(r.backend)
      order++
      contributions.push({
        order,
        member: str(r.family) ?? 'UNKNOWN',
        seat: null,
        role: 'contribution',
        status: mapStatus(str(r.status)),
        model: str(b?.model),
        provider: str(b?.provider),
        backendType: b?.backendType === 'LOCAL' || b?.backendType === 'EXTERNAL' ? b.backendType : null,
        latencyMs: typeof b?.latencyMs === 'number' ? b.latencyMs : null,
        respondsTo: [],
        agreements: [],
        disagreements: [],
        fallbackFrom: str(b?.fallbackFrom),
        failureReason: str(r.error),
      })
    }
  }
  contributions.sort((a, b) => a.order - b.order)

  const ok = contributions.filter(c => c.status === 'COMPLETED')
  const bad = contributions.filter(c => c.status !== 'COMPLETED')
  const selected = decision?.members ?? []
  const spoken = new Set(contributions.map(c => c.member.toUpperCase()))
  const missingMembers = selected.filter(m => !spoken.has(m.toUpperCase()))

  const required = contributions.map(c => `${c.order}:${c.member}`)
  const status = deriveTurnStatus({
    required,
    succeeded: ok.map(c => `${c.order}:${c.member}`),
    failed: bad.map(c => `${c.order}:${c.member}`),
    cancelled: false,
    interrupted: false,
    inFlight: false,
    waitingOnCommander: false,
    accepted: true,
  })

  const models = new Set(ok.map(c => `${c.provider ?? '?'}:${c.model ?? '?'}`))
  const distinctModels = models.size
  const sharedModelNote = ok.length > 1 && distinctModels === 1
    ? `All ${ok.length} contributions were generated by one model (${Array.from(models)[0]}); members differ by role contract and prompt, not by weights.`
    : null
  const reason = !contributions.length
    ? 'no member contribution is recorded for this turn'
    : `${ok.length} of ${contributions.length} contribution(s) completed${missingMembers.length ? `; selected but silent: ${missingMembers.join(', ')}` : ''}`

  return {
    status: missingMembers.length && status === 'COMPLETED' ? 'PARTIAL' : status,
    statusReason: reason,
    contributions,
    distinctModels,
    sharedModelNote,
    missingMembers,
    externalSourcesConsulted: 0,
    toolsInvoked: [],
  }
}
