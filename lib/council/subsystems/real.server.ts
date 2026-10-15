import 'server-only'
import { createSourceFabric, seedFoundationSources } from '@/lib/planetary-intelligence/sourceFabric'
import { buildCoverageMatrix } from '@/lib/planetary-intelligence/coverage'
import { buildTerraCoverageState } from '@/lib/planetary-intelligence/terraCoverage'
import { PUBLIC_GIBS_WMTS_BASE_URL } from '@/lib/earth-intelligence/gibsPublicBase'
import { getGibsServerConfigStatus } from '@/lib/earth-intelligence/gibsServerConfig'
import { worldClockStrip } from '@/lib/terra/worldTime'
import { chooseEncoder, resolveFfmpegTools } from '@/lib/media-command/ffmpeg'
import { listProjects } from '@/lib/media-command/store'
import type { SubsystemProbeDeps } from './probe'

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: unknown }>()
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

async function reachable(url: string, method: 'HEAD' | 'GET' = 'HEAD'): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(3000), headers: { 'User-Agent': 'WarRoomOS-Council-Probe' } })
    return { ok: res.ok, detail: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : 'network error' }
  }
}

/** The real interfaces behind each Council capability. Read-only: nothing here writes, renders, spends or publishes. */
export function realSubsystemDeps(): SubsystemProbeDeps {
  return {
    now: () => new Date().toISOString(),
    async terraCoverage() {
      const fabric = createSourceFabric()
      seedFoundationSources(fabric)
      const state = buildTerraCoverageState({ fabric, coverage: buildCoverageMatrix({ documents: [], claims: [] }), independentOrigins: 0, recentStoryFlow: 0 })
      return { activeSources: state.counts.activeSources, freshSources: state.counts.freshSources, languages: state.counts.languages.length, layers: state.layers.length }
    },
    terraGeocodeReachable: () => cached('geocode', () => reachable('https://nominatim.openstreetmap.org/status.php?format=json', 'GET')),
    async terraWorldImagery() {
      const status = getGibsServerConfigStatus()
      const base = PUBLIC_GIBS_WMTS_BASE_URL
      const probe = await cached('gibs', () => reachable(new URL('1.0.0/WMTSCapabilities.xml', base).toString()))
      return { configured: status.baseUrlConfigured, baseUrl: base, reachable: probe.ok, detail: probe.detail }
    },
    async terraWorldTime() {
      const rows = worldClockStrip(new Date().toISOString(), null)
      const first = rows[0]
      return { ok: rows.length > 0, sample: first ? `${first.label ?? ''} ${first.localTime ?? ''}`.trim() : '' }
    },
    async hvsTools() {
      const tools = await resolveFfmpegTools()
      const enc = await chooseEncoder().catch(() => null)
      return { ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, encoder: enc?.label ?? null }
    },
    async hvsProjects() {
      const rows = await listProjects()
      return { count: rows.length }
    },
  }
}
