import { SUBSYSTEM_LABELS, type CapabilityStatus, type SubsystemCapability, type SubsystemId, type SubsystemState } from './types'

/** Injected so the same logic is validated with fakes and runs against the real interfaces in the app. */
export type SubsystemProbeDeps = {
  now(): string
  terraCoverage(): Promise<{ activeSources: number; freshSources: number; languages: number; layers: number }>
  terraGeocodeReachable(): Promise<{ ok: boolean; detail: string }>
  terraWorldImagery(): Promise<{ configured: boolean; baseUrl: string; reachable: boolean; detail: string }>
  terraWorldTime(): Promise<{ ok: boolean; sample: string }>
  hvsTools(): Promise<{ ffmpeg: string | null; ffprobe: string | null; encoder: string | null }>
  hvsProjects(): Promise<{ count: number }>
}

const TIMEOUT_MS = 4000

async function bounded<T>(p: Promise<T>, label: string, ms = TIMEOUT_MS): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) })
    return { ok: true, value: await Promise.race([p, timeout]) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : `${label} failed` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function rollup(caps: SubsystemCapability[]): CapabilityStatus {
  if (caps.every(c => c.status === 'AVAILABLE')) return 'AVAILABLE'
  if (caps.every(c => c.status === 'UNAVAILABLE')) return 'UNAVAILABLE'
  return 'DEGRADED'
}

export async function probeSubsystems(deps: SubsystemProbeDeps): Promise<SubsystemState[]> {
  const at = deps.now()
  const cap = (c: Omit<SubsystemCapability, 'access' | 'probedAt'>): SubsystemCapability => ({ ...c, access: 'READ_ONLY', probedAt: at })

  const [coverage, geocode, imagery, wtime, tools, projects] = await Promise.all([
    bounded(deps.terraCoverage(), 'Terra coverage state'),
    bounded(deps.terraGeocodeReachable(), 'Terra geocoding'),
    bounded(deps.terraWorldImagery(), 'Terra World imagery'),
    bounded(deps.terraWorldTime(), 'world time'),
    bounded(deps.hvsTools(), 'HVS media tools'),
    bounded(deps.hvsProjects(), 'HVS project catalog'),
  ])

  const terraCaps: SubsystemCapability[] = [
    coverage.ok
      ? cap({
          id: 'terra.coverage_state', label: 'Coverage and blind spots', description: 'Where War Room can see and where it is blind: actual source counts, never invented percentages.',
          interface: 'GET /api/terra/coverage-state (lib/planetary-intelligence/terraCoverage)', status: 'AVAILABLE', reason: 'coverage state computed locally',
          facts: { activeSources: coverage.value.activeSources, freshSources: coverage.value.freshSources, languages: coverage.value.languages, layers: coverage.value.layers }, externalDependency: false,
        })
      : cap({ id: 'terra.coverage_state', label: 'Coverage and blind spots', description: 'Where War Room can see and where it is blind.', interface: 'GET /api/terra/coverage-state', status: 'UNAVAILABLE', reason: coverage.error, facts: {}, externalDependency: false }),
    geocode.ok
      ? cap({
          id: 'terra.resolve_location', label: 'Place and coordinate resolution', description: 'Resolve a typed place or latitude/longitude to a located, labelled position.',
          interface: 'GET /api/terra/resolve-location', status: geocode.value.ok ? 'AVAILABLE' : 'DEGRADED',
          reason: geocode.value.ok ? 'the geocoding service answered' : `the geocoding service did not answer: ${geocode.value.detail}`,
          facts: { reachable: geocode.value.ok }, externalDependency: true,
        })
      : cap({ id: 'terra.resolve_location', label: 'Place and coordinate resolution', description: 'Resolve a typed place or coordinates.', interface: 'GET /api/terra/resolve-location', status: 'UNAVAILABLE', reason: geocode.error, facts: { reachable: false }, externalDependency: true }),
  ]

  const worldCaps: SubsystemCapability[] = [
    imagery.ok
      ? cap({
          id: 'terra_world.imagery', label: 'Earth imagery (NASA GIBS)', description: 'Satellite imagery layers for the globe, from the public GIBS WMTS service (no API key).',
          interface: 'GET /api/earth-intelligence/health + public GIBS WMTS', status: imagery.value.reachable ? 'AVAILABLE' : 'DEGRADED',
          reason: imagery.value.reachable ? 'imagery service reachable' : `imagery service not reachable: ${imagery.value.detail}`,
          facts: { configured: imagery.value.configured, baseUrl: imagery.value.baseUrl, reachable: imagery.value.reachable }, externalDependency: true,
        })
      : cap({ id: 'terra_world.imagery', label: 'Earth imagery (NASA GIBS)', description: 'Satellite imagery layers for the globe.', interface: 'GET /api/earth-intelligence/health', status: 'UNAVAILABLE', reason: imagery.error, facts: {}, externalDependency: true }),
    wtime.ok
      ? cap({ id: 'terra_world.world_time', label: 'World time', description: 'Local times for places worldwide.', interface: 'lib/terra/worldTime', status: wtime.value.ok ? 'AVAILABLE' : 'UNAVAILABLE', reason: wtime.value.ok ? 'computed locally' : 'world time calculation failed', facts: { sample: wtime.value.sample }, externalDependency: false })
      : cap({ id: 'terra_world.world_time', label: 'World time', description: 'Local times for places worldwide.', interface: 'lib/terra/worldTime', status: 'UNAVAILABLE', reason: wtime.error, facts: {}, externalDependency: false }),
  ]

  const toolsReady = tools.ok && Boolean(tools.value.ffmpeg) && Boolean(tools.value.ffprobe)
  const hvsCaps: SubsystemCapability[] = [
    tools.ok
      ? cap({
          id: 'hvs.media_tools', label: 'Media toolchain', description: 'ffmpeg/ffprobe and the encoder HVS uses to analyse and render drafts.',
          interface: 'GET /api/media-command/status', status: toolsReady ? 'AVAILABLE' : tools.value.ffmpeg || tools.value.ffprobe ? 'DEGRADED' : 'UNAVAILABLE',
          reason: toolsReady ? 'ffmpeg and ffprobe resolved' : `missing: ${[!tools.value.ffmpeg && 'ffmpeg', !tools.value.ffprobe && 'ffprobe'].filter(Boolean).join(', ')}`,
          facts: { ffmpeg: Boolean(tools.value.ffmpeg), ffprobe: Boolean(tools.value.ffprobe), encoder: tools.value.encoder }, externalDependency: false,
        })
      : cap({ id: 'hvs.media_tools', label: 'Media toolchain', description: 'ffmpeg/ffprobe and the encoder.', interface: 'GET /api/media-command/status', status: 'UNAVAILABLE', reason: tools.error, facts: {}, externalDependency: false }),
    projects.ok
      ? cap({ id: 'hvs.projects', label: 'Project catalog', description: 'The list of Higher Vision Studios projects on this machine.', interface: 'GET /api/media-command/projects', status: 'AVAILABLE', reason: 'catalog read', facts: { projects: projects.value.count }, externalDependency: false })
      : cap({ id: 'hvs.projects', label: 'Project catalog', description: 'The list of HVS projects.', interface: 'GET /api/media-command/projects', status: 'UNAVAILABLE', reason: projects.error, facts: {}, externalDependency: false }),
  ]

  return [
    {
      id: 'terra', label: SUBSYSTEM_LABELS.terra, status: rollup(terraCaps), capabilities: terraCaps,
      summary: 'The earth-intelligence workspace: live geographic layers and the Commander-selected object handoff into Council.',
      notExposed: ['live object selection (the Commander selects objects in Terra and sends them to Council)', 'any write or tasking of sensors'],
    },
    {
      id: 'terra_world', label: SUBSYSTEM_LABELS.terra_world, status: rollup(worldCaps), capabilities: worldCaps,
      summary: 'The world layer of Terra: global imagery and world time.',
      notExposed: ['3D scene control', 'any imagery download or export'],
    },
    {
      id: 'hvs', label: SUBSYSTEM_LABELS.hvs, status: rollup(hvsCaps), capabilities: hvsCaps,
      summary: 'The AI media-production section: media toolchain and project catalog.',
      notExposed: ['rendering, generating or editing media', 'publishing (mayPublish is false)', 'spending (maySpend is false)'],
    },
  ]
}

export function subsystemQuestion(normalized: string, topics: string[]): SubsystemId[] | null {
  const t = normalized.toLowerCase()
  const asksState = /\b(status|available|availability|connected|connection|working|online|reachable|can you (use|access|reach|see)|do you have access|is .* (up|ready|running)|what can you do with)\b/.test(t)
  if (!asksState) return null
  const ids: SubsystemId[] = []
  if (/\bterra world\b|\bworld imagery\b|\bgibs\b|\bworld time\b/.test(t)) ids.push('terra_world')
  if (/\bterra\b/.test(t) && !ids.includes('terra_world')) ids.push('terra')
  if (/\bterra\b/.test(t) && ids.includes('terra_world') && !ids.includes('terra')) ids.push('terra')
  if (/\bhigher vision studios\b|\bhvs\b|\bmedia studio\b/.test(t) || topics.includes('higher vision studios')) ids.push('hvs')
  return ids.length ? ids : null
}

export function renderSubsystemAnswer(states: SubsystemState[], ids: SubsystemId[] | null): string {
  const chosen = ids ? states.filter(s => ids.includes(s.id)) : states
  const lines: string[] = []
  for (const s of chosen) {
    lines.push(`${s.label}: ${s.status}. ${s.summary}`)
    for (const c of s.capabilities) lines.push(`- ${c.label} [${c.status}] — ${c.reason}${Object.keys(c.facts).length ? ` (${Object.entries(c.facts).map(([k, v]) => `${k}=${String(v)}`).join(', ')})` : ''}. Interface: ${c.interface}.`)
    lines.push(`Not exposed to Council: ${s.notExposed.join('; ')}.`)
  }
  lines.push('Source: live probes run just now against the interfaces named above. Read-only; nothing was changed.')
  return lines.join('\n')
}
