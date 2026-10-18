import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { commanderActor } from '@/lib/agents/ops/api'
import { getMission, listMissions, serviceDeps, startFromApi, resumeMission, cancelMission, MissionError } from '@/lib/agents/ops/engineering/missions/service'
import { isMissionId } from '@/lib/agents/ops/engineering/missions/store'
import { AnalysisError, getAnalysis, listAnalyses, runAnalysis } from '@/lib/agents/ops/engineering/reverse/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Engineering missions (Foundry -> real engine). GET is read-only apart from dead-run reconciliation, which only ever moves a dead run to INTERRUPTED. */
export async function GET(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  const params = new URL(req.url).searchParams
  const id = params.get('id')
  const deps = serviceDeps()
  // Reverse Engineer records live beside the missions (read-only listing and detail)
  if (params.has('analyses')) return NextResponse.json({ generatedAt: new Date().toISOString(), analyses: listAnalyses({ log: deps.log }) })
  if (params.has('analysis')) {
    try {
      const a = getAnalysis(String(params.get('analysis')), { log: deps.log })
      return a ? NextResponse.json({ generatedAt: new Date().toISOString(), analysis: a }) : NextResponse.json({ error: 'unknown analysis' }, { status: 404 })
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid analysis id' }, { status: 400 }) }
  }
  if (id) {
    if (!isMissionId(id)) return NextResponse.json({ error: 'invalid mission id' }, { status: 400 })
    const m = getMission(deps, id)
    return m ? NextResponse.json({ generatedAt: new Date().toISOString(), mission: m }) : NextResponse.json({ error: 'unknown mission' }, { status: 404 })
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), missions: listMissions(deps) })
}

/** Commander controls: start, resume, cancel. The actor comes from the session only; a custom header blocks cross-site requests. */
export async function POST(req: Request) {
  const commander = await requireCommanderSession('Foundry')
  if (!commander.ok) return commander.response
  if (req.headers.get('x-wr-agent-ops') !== '1') return NextResponse.json({ error: 'missing control header' }, { status: 400 })
  let body: Record<string, unknown>
  try { const raw = await req.json(); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object'); body = raw as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  if (JSON.stringify(body).length > 65_536) return NextResponse.json({ error: 'request too large' }, { status: 413 })
  const actor = commanderActor(commander.userId)
  if (!actor) return NextResponse.json({ error: 'Commander session required' }, { status: 403 })
  const deps = serviceDeps()
  try {
    const action = String(body.action ?? '')
    if (action === 'analyze') {
      // read-only: reads the configured repository, writes one analysis record under the Agent Ops directory, runs no command and starts no mission
      const a = runAnalysis(body, actor, { log: deps.log })
      return NextResponse.json({ analysisId: a.id, kind: a.target.kind, owners: a.target.owners, evidence: a.evidence.length, readOnlyUnchanged: a.readOnly.unchanged }, { status: 201 })
    }
    if (action === 'start') { const m = await startFromApi(deps, body, actor); return NextResponse.json({ missionId: m.id, state: m.state }, { status: 202 }) }
    const id = String(body.id ?? '')
    if (!isMissionId(id)) return NextResponse.json({ error: 'invalid mission id' }, { status: 400 })
    if (action === 'resume') { resumeMission(deps, id, actor); return NextResponse.json({ missionId: id, resumed: true }, { status: 202 }) }
    if (action === 'cancel') { cancelMission(deps, id, actor, String(body.reason ?? 'Commander cancelled')); return NextResponse.json({ missionId: id, cancelRequested: true }, { status: 202 }) }
    return NextResponse.json({ error: 'unknown action', actions: ['start', 'resume', 'cancel', 'analyze'] }, { status: 400 })
  } catch (e) {
    if (e instanceof AnalysisError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'INVALID' ? 400 : e.code === 'NOT_FOUND' ? 404 : 422 })
    if (e instanceof MissionError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'NOT_FOUND' ? 404 : e.code === 'BUSY' || e.code === 'ILLEGAL' ? 409 : 422 })
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'invalid request' }, { status: 400 })
  }
}
