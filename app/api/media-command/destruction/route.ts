import { NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/media-command/store'
import { readJsonFile } from '@/lib/media-command/destruction/cache'
import type { HvsDestructionPlayback } from '@/lib/media-command/destruction/playback'
import { planDestruction, simulateApprovedDestruction } from '@/lib/media-command/destruction/contract'
import { applyApprovedDestructionPatch, proposeDestructionPatch } from '@/lib/media-command/destruction/patch'
import { invalidateDestructionCache } from '@/lib/media-command/destruction/execute'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  const project = await loadProject(projectId)
  const ticket = project?.destruction?.previsTicket
  if (!project || !ticket?.playbackRef || !project.destruction?.cache) {
    return NextResponse.json({ error: 'No destruction previs yet.' }, { status: 404 })
  }
  const playback = readJsonFile<HvsDestructionPlayback>(ticket.playbackRef)
  return NextResponse.json({
    playback,
    steps: project.destruction.plan?.commanderSteps ?? [],
    simulationRuns: project.destruction.cache.simulationRuns,
    summary: ticket.summary,
    approvalRequired: false,
    mutated: false,
  })
}

export async function POST(req: Request) {
  const body = await req.json() as {
    action?: string
    prompt?: string
    projectId?: string
    approval?: boolean
    planId?: string
  }
  const project = body.projectId ? await loadProject(body.projectId) : null
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  if (body.action === 'plan') {
    const planned = planDestruction(project, { prompt: body.prompt ?? '', projectId: project.id })
    return NextResponse.json({ ...planned, mutated: false })
  }
  if (body.action === 'patch') {
    const plan = project.destruction?.plan
    if (!plan) return NextResponse.json({ error: 'No destruction plan.' }, { status: 404 })
    return NextResponse.json({ patch: proposeDestructionPatch(plan, body.prompt ?? ''), approvalRequired: true, mutated: false })
  }
  if (body.approval !== true) {
    return NextResponse.json({ error: 'SIMULATE approval required.', approvalRequired: true, mutated: false }, { status: 403 })
  }
  if (body.action === 'apply-patch') {
    const plan = project.destruction?.plan
    if (!plan) return NextResponse.json({ error: 'No destruction plan.' }, { status: 404 })
    const patch = proposeDestructionPatch(plan, body.prompt ?? '')
    const revised = applyApprovedDestructionPatch(plan, patch, true)
    const invalidated = invalidateDestructionCache(project, 'Commander revised the destruction plan.')
    if (!invalidated.destruction) return NextResponse.json({ error: 'No destruction cache.' }, { status: 404 })
    invalidated.destruction = { ...invalidated.destruction, plan: revised, pendingPatch: null }
    await saveProject(invalidated)
    return NextResponse.json({ plan: revised, cacheStatus: 'INVALID', mutated: true, resimulated: false })
  }
  if (body.action === 'simulate') {
    const planned = project.destruction?.plan && project.destruction.intent
      ? { intent: project.destruction.intent, plan: project.destruction.plan }
      : planDestruction(project, { prompt: body.prompt ?? '', projectId: project.id })
    if (body.planId && planned.plan.id !== body.planId) {
      return NextResponse.json({ error: 'planId does not match the plan.' }, { status: 400 })
    }
    const result = await simulateApprovedDestruction(project, {
      planId: planned.plan.id,
      plan: planned.plan,
      intent: planned.intent,
      approval: true,
    })
    if (!result.ok) return NextResponse.json({ error: result.error, mutated: false }, { status: 500 })
    await saveProject(result.project)
    return NextResponse.json({
      ok: true,
      mutated: true,
      resimulated: result.resimulated,
      cacheManifestId: result.cacheManifestId,
      summary: result.project.destruction?.previsTicket?.summary ?? null,
      fractureBackend: result.fractureBackend,
      physicsBackend: result.physicsBackend,
      previsBackend: result.previsBackend,
      volumeExecution: result.volumeExecution,
    })
  }
  return NextResponse.json({ error: 'Unknown destruction action.', mutated: false }, { status: 400 })
}
