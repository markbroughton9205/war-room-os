import { NextResponse } from 'next/server'
import { detectCouncilResearchIntent } from '@/lib/council-research/intent'
import { runCouncilResearchTeam } from '@/lib/council-research/orchestrator'
import type { CouncilStoryContext, ResearchStatus } from '@/lib/council-research/types'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const maxDuration = 120

function coerceStoryContext(raw: unknown): CouncilStoryContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.headline !== 'string' || typeof o.source !== 'string') return undefined
  return {
    headline: o.headline,
    source: o.source,
    url: typeof o.url === 'string' ? o.url : null,
    category: typeof o.category === 'string' ? o.category : 'uncategorized',
    shortSummary: typeof o.shortSummary === 'string' ? o.shortSummary : '',
    whyItMatters: typeof o.whyItMatters === 'string' ? o.whyItMatters : '',
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
    freshnessStatus:
      o.freshnessStatus === 'LIVE'
      || o.freshnessStatus === 'RECENT'
      || o.freshnessStatus === 'ARCHIVAL'
      || o.freshnessStatus === 'UNKNOWN_DATE'
        ? o.freshnessStatus
        : 'UNKNOWN_DATE',
    provider: typeof o.provider === 'string' ? o.provider : 'manual',
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const decree = typeof body.decree === 'string' ? body.decree.trim() : ''
  if (!decree) {
    return NextResponse.json({ error: 'No decree' }, { status: 400 })
  }

  const storyContext = coerceStoryContext(body.storyContext)
  const threadId = typeof body.threadId === 'string' ? body.threadId : null
  const profile = typeof body.profile === 'string' ? body.profile : ''
  void profile

  const intent = detectCouncilResearchIntent(decree, {
    forceTeamResearch: body.forceTeamResearch === true || Boolean(storyContext),
  })

  if (!intent.triggered && body.forceTeamResearch !== true) {
    return NextResponse.json(
      { error: 'not_research_intent', reasons: intent.reasons },
      { status: 400 },
    )
  }

  const phaseLog: ResearchStatus[] = []
  const sup = tryWarRoomSupabase()

  try {
    const report = await runCouncilResearchTeam({
      decree,
      storyContext,
      threadId,
      onPhase: p => {
        phaseLog.push(p)
      },
    })

    await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'system',
      category: 'engine',
      message: 'Council research team completed',
      metadata: {
        route: '/api/council/research',
        sourceCount: report.sources.length,
        confidenceLevel: report.confidenceLevel,
        sourcesUnavailable: report.sourcesUnavailable,
        threadId,
      },
    })

    return NextResponse.json({
      ok: true,
      report,
      phases: report.phases.length ? report.phases : phaseLog,
      councilResearchTeam: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
      actor: 'system',
      category: 'engine',
      message: 'Council research team failed',
      metadata: { route: '/api/council/research', error: message },
    })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
