import 'server-only'
import { buildAttribution } from './attribution'
import { persistStage1Turn } from './persist'
import { buildTurnRecord, type Stage1ResearchRecord } from './record'
import { researchUiFromReport } from './researchUi'
import type { Stage1TurnResult } from './server'

type AnyRec = Record<string, unknown>
const rec = (v: unknown): AnyRec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : null)

export function researchRecordFromPayload(payload: AnyRec): Stage1ResearchRecord | null {
  const report = rec(payload.councilResearchReport)
  if (report && Array.isArray(report.sources)) {
    const sources = (report.sources as AnyRec[]).map(s => ({
      url: typeof s.url === 'string' ? s.url : null,
      title: String(s.title ?? ''),
      evidenceLabel: String(s.evidenceLabel ?? 'UNVERIFIED'),
      accepted: typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && (s.evidenceLabel === 'LIVE_SIGNAL_BACKED' || s.evidenceLabel === 'CACHED'),
    }))
    const ui = researchUiFromReport({
      sources: report.sources as never,
      sourcesUnavailable: report.sourcesUnavailable === true,
      unknowns: Array.isArray(report.unknowns) ? (report.unknowns as string[]) : [],
    })
    return {
      mode: ui.mode, sourcesCount: ui.sourcesCount, label: ui.label,
      accepted: ui.accepted, considered: ui.considered, rejected: ui.rejected,
      sources, unknowns: Array.isArray(report.unknowns) ? (report.unknowns as string[]).slice(0, 8) : [],
    }
  }
  const ui = rec(payload.liveResearchUi)
  if (ui && payload.liveResearchAttempted) {
    return {
      mode: String(ui.mode ?? 'unknown'), sourcesCount: Number(ui.sourcesCount ?? 0), label: String(ui.label ?? ''),
      accepted: null, considered: null, rejected: null, sources: [], unknowns: [],
    }
  }
  return null
}

/** Fire-and-forget; never throws and never affects the response. */
export function recordStage1Turn(args: {
  req: Request
  conversationId: string | null | undefined
  stage1: Stage1TurnResult
  payload: AnyRec
  councilStage1: AnyRec | undefined
}): void {
  void (async () => {
    try {
      const { stage1, payload } = args
      const self = stage1.finalResponse
      const results = Array.isArray(payload.results) ? (payload.results as AnyRec[]) : []
      const responseText = typeof payload.councilSingleResponse === 'string'
        ? payload.councilSingleResponse
        : String(results.find(r => typeof r.content === 'string' && r.content)?.content ?? '')
      const attribution = self ? null : (rec(args.councilStage1)?.attribution as ReturnType<typeof buildAttribution> | undefined) ?? buildAttribution(payload, stage1.decision)
      const record = buildTurnRecord({
        turnId: stage1.provenance.turnId,
        decree: stage1.understanding.raw,
        responseText,
        mode: typeof payload.mode === 'string' ? payload.mode : null,
        understanding: stage1.understanding,
        decision: stage1.decision,
        attribution,
        selfStatus: self?.status,
        responder: self ? { kind: 'deterministic', label: self.mode === 'stage1_self_knowledge' ? 'War Room knowledge (installed state + docs)' : 'Clarification', model: null } : null,
        research: researchRecordFromPayload(payload),
        localKnowledge: self ? self.claims.map(c => ({ id: c.id, status: c.status, source: c.source })) : [],
      })
      await persistStage1Turn(args.req, args.conversationId, record)
    } catch {
      /* attribution persistence must never affect a response */
    }
  })()
}
