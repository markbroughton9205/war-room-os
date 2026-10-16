import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { engineeringRepo, getMission, listMissions, serviceDeps } from '@/lib/agents/ops/engineering/missions/service'
import { probeSubsystems } from '@/lib/council/subsystems/probe'
import { realSubsystemDeps } from '@/lib/council/subsystems/real.server'
import { listProjects, loadProject } from '@/lib/media-command/store'
import { resolveFfmpegTools } from '@/lib/media-command/ffmpeg'
import { foundryPlanet, hvsPlanet, terraPlanet, type FoundryMissionSummary, type HvsRenderJob } from '@/lib/council/immersive/planets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/** Read-only planet status for the immersive Council. Every value comes from Foundry's mission records, the HVS catalog/render queue or the subsystem probes. */
export async function GET() {
  const commander = await requireCommanderSession('Council planets')
  if (!commander.ok) return commander.response

  // Foundry
  let foundryMissions: FoundryMissionSummary[] | null = null
  let foundryAvailable = false
  let foundryReason: string | null = null
  try {
    const deps = serviceDeps()
    foundryAvailable = Boolean(engineeringRepo(deps.log))
    if (!foundryAvailable) foundryReason = 'no engineering repository is configured'
    const listed = listMissions(deps).slice(0, 12)
    let detailReads = 0
    foundryMissions = listed.map(m => {
      let receiptVerified = false
      // The listing does not re-verify receipts on disk; a detail read does. Verify the few most recent completed missions, never assume.
      if (m.state === 'COMPLETED' && detailReads < 5) {
        detailReads += 1
        const d = getMission(deps, m.id)
        receiptVerified = d?.receiptCheck !== undefined && d.receiptCheck !== 'NO_RECEIPT' && d.receiptCheck.ok === true
      }
      const liveness = m.liveness as { verdict?: string } | null
      return {
        id: m.id, title: m.title, state: m.state, liveness: liveness?.verdict ?? null,
        progress: m.progress ? { stepsDone: m.progress.stepsDone, stepsTotal: m.progress.stepsTotal, modelCalls: m.progress.modelCalls } : null,
        worker: m.worker ? { workerId: m.worker.workerId, heartbeatAgeSec: m.worker.heartbeatAgeSec } : null,
        verifierExit: typeof m.receipt?.verifier?.exitCode === 'number' ? m.receipt.verifier.exitCode : null,
        receiptVerified,
      }
    })
  } catch (e) {
    foundryReason = e instanceof Error ? e.message.slice(0, 120) : 'read failed'
  }

  // HVS
  let projects: number | null = null
  let projectNames: string[] = []
  let jobs: HvsRenderJob[] | null = null
  let toolsOk: boolean | null = null
  let toolsReason: string | null = null
  let hvsError: string | null = null
  try {
    const catalog = await listProjects()
    projects = catalog.length
    projectNames = catalog.slice(0, 5).map(e => e.name)
    const all: HvsRenderJob[] = []
    for (const entry of catalog.slice(0, 40)) {
      const p = await loadProject(entry.id)
      if (p) for (const j of p.renderJobs ?? []) all.push({ status: j.status })
    }
    jobs = all
    const tools = await resolveFfmpegTools()
    toolsOk = Boolean(tools.ffmpeg && tools.ffprobe)
    if (!toolsOk) toolsReason = `missing: ${[!tools.ffmpeg && 'ffmpeg', !tools.ffprobe && 'ffprobe'].filter(Boolean).join(', ')}`
  } catch (e) {
    hvsError = e instanceof Error ? e.message.slice(0, 120) : 'read failed'
  }

  // Terra
  let terra: { status: string; reasons: string[] } | null = null
  let world: { status: string; reasons: string[] } | null = null
  try {
    const states = await probeSubsystems(realSubsystemDeps())
    const pick = (id: string) => {
      const s = states.find(x => x.id === id)
      return s ? { status: s.status, reasons: s.capabilities.filter(c => c.status !== 'AVAILABLE').map(c => `${c.label}: ${c.reason}`) } : null
    }
    terra = pick('terra'); world = pick('terra_world')
  } catch { /* planet reports UNAVAILABLE */ }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    planets: [
      foundryPlanet({ available: foundryAvailable, reason: foundryReason, missions: foundryMissions }),
      hvsPlanet({ projectNames, projects, jobs, toolsOk, toolsReason, error: hvsError }),
      terraPlanet({ terra, world }),
    ],
  }, { headers: { 'cache-control': 'no-store' } })
}
