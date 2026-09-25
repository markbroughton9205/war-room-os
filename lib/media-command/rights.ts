/**
 * HVS rights fail closed. Public visibility, museum hosting, IIIF, or government
 * URLs never imply commercial clearance. Only OWNABLE is commercial_ok.
 */
import type { AssetRecord, AssetRights, HvsProject, HvsRightsState } from './types'
import { HVS_RIGHTS_STATES } from './types'

const COMMERCIAL_OK_STATES = new Set<HvsRightsState>(['OWNABLE'])

export function isHvsRightsState(value: unknown): value is HvsRightsState {
  return typeof value === 'string' && (HVS_RIGHTS_STATES as readonly string[]).includes(value)
}

export function unknownRights(notes?: string): AssetRights {
  return { state: 'UNKNOWN', commercialOk: false, source: null, notes: notes ?? 'Required rights metadata absent.' }
}

export function normalizeRights(rights?: AssetRights | null): AssetRights {
  if (!rights || !isHvsRightsState(rights.state)) return unknownRights('Required rights metadata absent.')
  const commercialOk = COMMERCIAL_OK_STATES.has(rights.state) && rights.commercialOk !== false
  return {
    state: rights.state,
    commercialOk: rights.state === 'OWNABLE' ? commercialOk : false,
    source: rights.source ?? null,
    notes: rights.notes ?? null,
  }
}

export function rightsForAsset(asset: Pick<AssetRecord, 'rights'>): AssetRights {
  return normalizeRights(asset.rights)
}

export function commercialOkForAsset(asset: Pick<AssetRecord, 'id' | 'rights' | 'role'>): { ok: boolean; reason: string } {
  const rights = rightsForAsset(asset)
  if (asset.role === 'PROXY') {
    return { ok: false, reason: `Asset ${asset.id} is PROXY and cannot be a commercial master source.` }
  }
  if (rights.state === 'UNKNOWN') {
    return { ok: false, reason: `Asset ${asset.id} rights are UNKNOWN; commercial_ok=false.` }
  }
  if (!rights.commercialOk) {
    return { ok: false, reason: `Asset ${asset.id} rights ${rights.state} are not commercial-clear.` }
  }
  return { ok: true, reason: `Asset ${asset.id} is OWNABLE.` }
}

export function commercialOkForProject(project: Pick<HvsProject, 'id' | 'assets' | 'timeline'>): {
  ok: boolean
  commercialOk: false | true
  reason: string
  blockingAssetIds: string[]
} {
  const usedIds = new Set<string>()
  for (const track of project.timeline?.tracks ?? []) {
    for (const clip of track.clips) usedIds.add(clip.assetId)
  }
  const assets = usedIds.size
    ? project.assets.filter(asset => usedIds.has(asset.id) && asset.role !== 'PROXY')
    : project.assets.filter(asset => asset.role !== 'PROXY')
  if (!assets.length) {
    return {
      ok: false,
      commercialOk: false,
      reason: 'No ORIGINAL assets with rights metadata are on the timeline.',
      blockingAssetIds: [],
    }
  }
  const blocking: string[] = []
  const reasons: string[] = []
  for (const asset of assets) {
    const verdict = commercialOkForAsset(asset)
    if (!verdict.ok) {
      blocking.push(asset.id)
      reasons.push(verdict.reason)
    }
  }
  if (blocking.length) {
    return { ok: false, commercialOk: false, reason: reasons.join(' '), blockingAssetIds: blocking }
  }
  return { ok: true, commercialOk: true, reason: 'All timeline ORIGINAL assets are OWNABLE.', blockingAssetIds: [] }
}
