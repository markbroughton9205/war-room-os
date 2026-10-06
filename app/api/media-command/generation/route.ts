import { NextResponse } from 'next/server'
import { loadProject } from '@/lib/media-command/store'
import { inspectGenerationRequest, inspectLocalEngineSurface, surfaceFromJob } from '@/lib/media-command/generation-authority'
import { requestInstallApproval, beginInstallForbidden, localEngineCards } from '@/lib/media-command/model-install'
import { PIPER_INSTALL_PLAN, COMFYUI_FLUX_INSTALL_PLAN, LOCAL_MODEL_STORAGE_POLICY } from '@/lib/media-command/local-generation-plans'
import { listJobs } from '@/lib/media-command/jobs'
import { persistRoutedJob, routeCapability } from '@/lib/media-command/provider-router'
import { REMOTE_GENERATION_ADAPTERS } from '@/lib/media-command/provider-adapters'
import { normalizeGenerateRequest } from '@/lib/media-command/generation-requests'
import type { HvsCapability } from '@/lib/media-command/provider-registry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const capability = (url.searchParams.get('capability') ?? 'IMAGE_GENERATION') as HvsCapability
  const inspect = inspectGenerationRequest(capability, projectId || 'probe', 'key art')
  const local = inspectLocalEngineSurface(capability)
  const jobs = projectId ? listJobs(projectId).filter(j => j.kind === 'provider').map(surfaceFromJob) : []
  return NextResponse.json({
    inspect,
    local,
    localEngines: localEngineCards(),
    jobs,
    adapters: REMOTE_GENERATION_ADAPTERS.map(a => ({
      id: a.id,
      capabilities: a.capabilities,
      health: a.health(),
      local: a.local,
    })),
    plans: {
      piper: { officialRepository: PIPER_INSTALL_PLAN.officialRepository, notAuthorizedNow: true, adapter: PIPER_INSTALL_PLAN.adapter },
      comfyuiFlux: { officialRepository: COMFYUI_FLUX_INSTALL_PLAN.officialRepository, notAuthorizedNow: true, adapter: COMFYUI_FLUX_INSTALL_PLAN.adapter },
      storage: LOCAL_MODEL_STORAGE_POLICY.layout,
    },
    note: 'LOCAL ENGINE NOT INSTALLED. No HTTP generation. Generate does not install models.',
  })
}

export async function POST(req: Request) {
  let body: { projectId?: string; capability?: HvsCapability; prompt?: string; action?: 'queue' | 'cancel' | 'approve-later' | 'request-install'; engineId?: 'piper' | 'comfyui-flux' } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (body.action === 'cancel' || body.action === 'approve-later') {
    return NextResponse.json({ ok: true, action: body.action, executed: false, note: 'No generation ran.' })
  }
  if (body.action === 'request-install') {
    const engineId = body.engineId ?? 'piper'
    const result = requestInstallApproval(engineId)
    return NextResponse.json({ ...result, install: beginInstallForbidden(engineId), generated: false })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 })
  const project = await loadProject(body.projectId)
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  const capability = body.capability ?? 'IMAGE_GENERATION'
  const prompt = body.prompt ?? 'key art'
  const request = normalizeGenerateRequest({
    projectId: project.id,
    prompt,
    authority: { spendApproved: false, externalUploadApproved: false },
  })
  const decision = routeCapability({ capability, projectId: project.id, prompt: request.prompt })
  const job = persistRoutedJob({
    request: { capability, projectId: project.id, versionId: project.currentVersionId, prompt: request.prompt },
    decision,
    actor: 'human',
  })
  return NextResponse.json({
    job,
    surface: surfaceFromJob(job),
    executed: false,
    http: false,
  }, { status: 201 })
}
