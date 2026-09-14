/**
 * Bounded Foundry ↔ Terra relationship.
 * Visual reuse of canonical NASA GIBS Terra imagery. Not Terra2, not a new globe runtime,
 * not autonomous Terra execution, and never labeled LIVE for daily/cached mosaics.
 */
import { getGibsLayer, DEFAULT_GIBS_LAYER_ID } from '@/lib/earth-intelligence/gibsLayers'
import { isRequestableIsoDate } from '@/lib/earth-intelligence/gibsTileUrl'
import { isWarRoomSelfEditRequest, WAR_ROOM_CANONICAL_WORKSPACE_ID } from '@/lib/native-builder/foundryWorkspaceIdentityCore'

export const FOUNDRY_TERRA_GIBS_WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
export const FOUNDRY_TERRA_LAYER_ID = DEFAULT_GIBS_LAYER_ID
export const FOUNDRY_TERRA_TRUTH_PASSIVE = 'NASA_GIBS_DAILY_PASSIVE'
export const FOUNDRY_TERRA_TRUTH_UNAVAILABLE = 'NASA_GIBS_UNAVAILABLE'
export const FOUNDRY_TERRA_TRUTH_PREVIEW = 'TERRA_BUILD_PREVIEW'
export const FOUNDRY_TERRA_QUERY_KEY = 'terra'

export const FOUNDRY_TERRA_CANONICAL_SOURCE_PREFIXES = [
  'components/war-room/terra/',
  'lib/terra/',
  'lib/earth-intelligence/',
  'app/terra/',
  'app/api/terra/',
  'app/api/earth-intelligence/',
] as const

export const FOUNDRY_TERRA_IDENTITY_LABELS = [
  'TERRA',
  'GLOBAL INTELLIGENCE',
  'REAL-WORLD IMPACT',
  'PEOPLE',
  'PLACES',
  'PATTERNS',
  'POSSIBILITIES',
  'REAL DATA',
  'REAL CONTEXT',
  'A SAFER TOMORROW',
] as const

export type FoundryTerraContextMode = 'none' | 'build' | 'preview'

export type FoundryTerraBackgroundTruth = {
  label: typeof FOUNDRY_TERRA_TRUTH_PASSIVE | typeof FOUNDRY_TERRA_TRUTH_UNAVAILABLE | typeof FOUNDRY_TERRA_TRUTH_PREVIEW
  live: false
  pointerEvents: 'none' | 'auto'
  observationDay: string
}

/**
 * Same honesty rule as TerraEarthImagery: GIBS daily products use the previous
 * completed UTC observation day so the texture is never presented as continuously live.
 */
export function foundryTerraCompletedObservationDay(now = new Date()): string {
  const safe = Number.isNaN(now.getTime()) ? new Date() : now
  return new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth(), safe.getUTCDate()) - 86_400_000)
    .toISOString()
    .slice(0, 10)
}

export function buildFoundryTerraGibsMosaicUrl(isoDate?: string): string {
  const layer = getGibsLayer(FOUNDRY_TERRA_LAYER_ID)
  if (!layer || layer.status !== 'available') {
    throw new Error('Canonical Terra true-color GIBS layer is not renderable')
  }
  const date = isoDate ?? foundryTerraCompletedObservationDay()
  if (!isRequestableIsoDate(date)) {
    throw new Error('Invalid date for Foundry Terra GIBS mosaic')
  }
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layer.identifier,
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: '2048',
    HEIGHT: '1024',
    FORMAT: 'image/jpeg',
    TIME: date,
  })
  return `${FOUNDRY_TERRA_GIBS_WMS_BASE}?${params.toString()}`
}

export function parseFoundryTerraContext(value: string | null | undefined): FoundryTerraContextMode {
  if (value === 'build') return 'build'
  if (value === 'preview') return 'preview'
  return 'none'
}

export function foundryTerraBackgroundTruth(
  mode: FoundryTerraContextMode,
  imageryAvailable: boolean,
  now = new Date(),
): FoundryTerraBackgroundTruth {
  const observationDay = foundryTerraCompletedObservationDay(now)
  const pointerEvents = mode === 'preview' ? 'auto' : 'none'
  if (!imageryAvailable) {
    return {
      label: FOUNDRY_TERRA_TRUTH_UNAVAILABLE,
      live: false,
      pointerEvents,
      observationDay,
    }
  }
  if (mode === 'preview') {
    return {
      label: FOUNDRY_TERRA_TRUTH_PREVIEW,
      live: false,
      pointerEvents,
      observationDay,
    }
  }
  return {
    label: FOUNDRY_TERRA_TRUTH_PASSIVE,
    live: false,
    pointerEvents: 'none',
    observationDay,
  }
}

export function isTerraSourcePath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').replace(/^\.\//, '')
  return FOUNDRY_TERRA_CANONICAL_SOURCE_PREFIXES.some(prefix => n === prefix.replace(/\/$/, '') || n.startsWith(prefix))
    || /(^|\/)terra\//i.test(n)
    || /(^|\/)earth-intelligence\//i.test(n)
}

export function isTerraBuildRequest(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (/\bterra\b/i.test(value) && isWarRoomSelfEditRequest(value)) return true
  return /\bterra\b/i.test(value) && /\b(ui|globe|earth|background|visual|component|imagery|build|preview)\b/i.test(value)
}

export function terraBuildContextBinding(mode: FoundryTerraContextMode): {
  workspaceId: typeof WAR_ROOM_CANONICAL_WORKSPACE_ID | null
  autonomous: false
  physicalAuthority: false
  duplicateRuntime: false
} {
  return {
    workspaceId: mode === 'none' ? null : WAR_ROOM_CANONICAL_WORKSPACE_ID,
    autonomous: false,
    physicalAuthority: false,
    duplicateRuntime: false,
  }
}

export function foundryTerraNeverLabeledLive(label: string): boolean {
  return label !== 'LIVE' && !/(^|[^A-Z])LIVE([^A-Z]|$)/.test(label)
}
