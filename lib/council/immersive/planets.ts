/**
 * Planet status for the immersive Council: Foundry, Higher Vision Studios and Terra.
 * Pure builders over real records. When a source cannot be read the planet says UNAVAILABLE and why; nothing is inferred or invented.
 */
export type PlanetId = 'foundry' | 'hvs' | 'terra'
export type PlanetHealth = 'ACTIVE' | 'READY' | 'DEGRADED' | 'UNAVAILABLE'

export type PlanetStatus = {
  id: PlanetId
  name: string
  health: PlanetHealth
  /** One honest sentence about what is real right now. */
  headline: string
  /** Extra facts, each with its provenance in the sentence itself. */
  facts: string[]
  href: string
  /** Concrete records behind the planet (recent missions with receipts, projects, render jobs). Each line states its own evidence. */
  items: Array<{ label: string; detail: string; tone: 'ok' | 'active' | 'warn' | 'bad' | 'neutral' }>
  /** True only when something is actually running (a live mission, a running render job). */
  activity: boolean
}

export type FoundryMissionSummary = {
  id: string
  title: string
  state: string
  liveness?: string | null
  progress?: { stepsDone: number; stepsTotal: number; modelCalls?: number } | null
  worker?: { workerId?: string | null; heartbeatAgeSec?: number | null } | null
  receiptVerified?: boolean
  /** True only when the receipt was actually re-verified for this mission (listing views do not verify). */
  receiptChecked?: boolean
  verifierExit?: number | null
}

const WORKING_STATES = new Set(['RUNNING', 'VERIFYING', 'APPLYING', 'INSTALLING'])
const LIVE_STATES = new Set(['QUEUED', ...WORKING_STATES])

export function foundryPlanet(input: { available: boolean; reason?: string | null; missions: FoundryMissionSummary[] | null }): PlanetStatus {
  const base = { id: 'foundry' as const, name: 'Foundry', href: '/foundry' }
  if (input.missions === null) return { ...base, health: 'UNAVAILABLE', headline: `Foundry status could not be read${input.reason ? `: ${input.reason}` : ''}`, facts: [], items: [], activity: false }
  // Activity (ring, pause) only for a worker that is demonstrably alive; queued, stalled and dead runs are stated as such.
  const live = input.missions.filter(m => WORKING_STATES.has(m.state) && m.liveness === 'ALIVE')
  const stalled = input.missions.filter(m => WORKING_STATES.has(m.state) && m.liveness === 'STALLED')
  const queued = input.missions.filter(m => m.state === 'QUEUED')
  const facts: string[] = []
  const lead = live[0] ?? stalled[0]
  if (lead) {
    facts.push(`Mission ${lead.id}: ${lead.state}${lead.liveness === 'STALLED' ? ' (stalled: no recent progress)' : ''}${lead.progress ? `, step ${lead.progress.stepsDone}/${lead.progress.stepsTotal}` : ''}`)
    if (lead.worker?.workerId) facts.push(`Worker ${lead.worker.workerId}${typeof lead.worker.heartbeatAgeSec === 'number' ? `, heartbeat ${lead.worker.heartbeatAgeSec}s ago` : ''}`)
  }
  if (queued.length) facts.push(`${queued.length} mission(s) queued`)
  const proven = input.missions.filter(m => m.state === 'COMPLETED' && m.verifierExit === 0 && m.receiptVerified)
  const failed = input.missions.filter(m => m.state === 'FAILED').length
  facts.push(`${proven.length} mission(s) completed with verifier exit 0 and a verified receipt; ${failed} failed (of the last ${input.missions.length})`)
  if (!input.available) facts.push(`Cannot start new missions: ${input.reason ?? 'no engineering repository configured'}`)
  const items = input.missions.slice(0, 5).map(m => {
    const done = m.state === 'COMPLETED'
    const provenM = done && m.verifierExit === 0 && m.receiptVerified === true
    const detail = done
      ? `COMPLETED · verifier exit ${m.verifierExit ?? 'n/a'} · receipt ${m.receiptChecked ? (m.receiptVerified ? 'verified' : 'NOT verified') : 'not checked'}`
      : `${m.state}${m.liveness === 'DEAD' ? ' (worker not alive)' : ''}${m.progress ? ` · step ${m.progress.stepsDone}/${m.progress.stepsTotal}` : ''}`
    const tone = provenM ? 'ok' as const : done ? 'warn' as const : m.state === 'FAILED' ? 'bad' as const : LIVE_STATES.has(m.state) ? 'active' as const : 'neutral' as const
    return { label: `${m.id} — ${m.title}`.slice(0, 90), detail, tone }
  })
  if (live.length) return { ...base, health: 'ACTIVE', headline: `${live.length} mission${live.length === 1 ? '' : 's'} running`, facts, items, activity: true }
  if (stalled.length) return { ...base, health: 'DEGRADED', headline: `${stalled.length} mission${stalled.length === 1 ? '' : 's'} stalled — no recent progress`, facts, items, activity: false }
  if (queued.length) return { ...base, health: input.available ? 'READY' : 'DEGRADED', headline: `${queued.length} mission${queued.length === 1 ? '' : 's'} queued, none running`, facts, items, activity: false }
  return { ...base, health: input.available ? 'READY' : 'DEGRADED', headline: input.available ? 'No mission running' : 'Cannot start missions on this machine', facts, items, activity: false }
}

export type HvsRenderJob = { status: string; updatedAt?: string | null }
const HVS_FRESH_MS = 15 * 60_000
export function hvsPlanet(input: { now?: number; projectNames?: string[]; projects: number | null; jobs: HvsRenderJob[] | null; toolsOk: boolean | null; toolsReason?: string | null; error?: string | null }): PlanetStatus {
  const base = { id: 'hvs' as const, name: 'Higher Vision Studios', href: '/higher-vision-studios' }
  if (input.projects === null) return { ...base, health: 'UNAVAILABLE', headline: `HVS status could not be read${input.error ? `: ${input.error}` : ''}`, facts: [], items: [], activity: false }
  const facts = [`${input.projects} project${input.projects === 1 ? '' : 's'} in the catalog`]
  const jobs = input.jobs ?? []
  const now = input.now ?? Date.now()
  const marked = jobs.filter(j => j.status === 'running')
  // A persisted 'running' flag survives a crash; only a recent update counts as a render in progress.
  const running = marked.filter(j => j.updatedAt && now - Date.parse(j.updatedAt) <= HVS_FRESH_MS).length
  const unconfirmed = marked.length - running
  const queued = jobs.filter(j => j.status === 'queued').length
  const failed = jobs.filter(j => j.status === 'failed').length
  const completed = jobs.filter(j => j.status === 'completed').length
  facts.push(input.jobs ? `Render jobs: ${running} running, ${queued} queued, ${completed} completed, ${failed} failed` : 'Render jobs could not be read')
  if (unconfirmed > 0) facts.push(`${unconfirmed} job(s) are marked running but have not updated for over 15 minutes (unconfirmed; not counted as active)`)
  if (input.toolsOk === false) facts.push(`Media toolchain unavailable${input.toolsReason ? `: ${input.toolsReason}` : ''} — rendering cannot run on this machine`)
  const items = (input.projectNames ?? []).slice(0, 5).map(n => ({ label: n, detail: 'project in the catalog', tone: 'neutral' as const }))
  const unreadable = input.jobs === null || input.toolsOk === null
  if (input.toolsOk === null) facts.push('Media toolchain status could not be read')
  const health: PlanetHealth = running > 0 ? 'ACTIVE' : unreadable || input.toolsOk === false ? 'DEGRADED' : 'READY'
  return { ...base, health, headline: running > 0 ? `${running} render${running === 1 ? '' : 's'} running` : unreadable ? 'Some HVS sources could not be read' : input.toolsOk === false ? 'Production available only without rendering' : 'Production ready', facts, items, activity: running > 0 }
}

export function terraPlanet(input: { terra: { status: string; reasons: string[] } | null; world: { status: string; reasons: string[] } | null }): PlanetStatus {
  const base = { id: 'terra' as const, name: 'Terra', href: '/terra' }
  if (!input.terra && !input.world) return { ...base, health: 'UNAVAILABLE', headline: 'Terra status could not be read', facts: [], items: [], activity: false }
  const norm = (s: string): PlanetHealth => (s === 'AVAILABLE' ? 'READY' : s === 'DEGRADED' ? 'DEGRADED' : 'UNAVAILABLE')
  const parts = [input.terra && { n: 'Terra', ...input.terra }, input.world && { n: 'Terra World', ...input.world }].filter(Boolean) as Array<{ n: string; status: string; reasons: string[] }>
  const facts = parts.map(p => `${p.n}: ${p.status}${p.reasons.length ? ` (${p.reasons.slice(0, 2).join('; ')})` : ''}`)
  const worst = parts.map(p => norm(p.status)).sort((a, b) => ['READY', 'DEGRADED', 'UNAVAILABLE'].indexOf(b) - ['READY', 'DEGRADED', 'UNAVAILABLE'].indexOf(a))[0]
  return { ...base, health: worst, headline: worst === 'READY' ? 'Earth intelligence ready' : worst === 'DEGRADED' ? 'Earth intelligence partly available' : 'Earth intelligence unavailable', facts, items: [], activity: false }
}
