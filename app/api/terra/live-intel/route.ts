import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { fetchTerraLiveIntel } from '@/lib/terra/fetchLiveIntel'
import { TERRA_LIVE_LAYER_IDS, type TerraLiveLayerId } from '@/lib/terra/liveGeoIntelligence'
import { TERRA_TIME_WINDOW_PRESETS } from '@/lib/terra/terraTime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseLayers(raw: string | null): TerraLiveLayerId[] | undefined {
  if (!raw?.trim()) return undefined
  const ids = raw.split(',').map(part => part.trim()).filter((part): part is TerraLiveLayerId => (
    TERRA_LIVE_LAYER_IDS as readonly string[]
  ).includes(part))
  return ids.length ? ids : undefined
}

export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra live intel')
  if (!commander.ok) return commander.response

  const windowId = request.nextUrl.searchParams.get('window') ?? 'all'
  const timeWindow = TERRA_TIME_WINDOW_PRESETS.find(preset => preset.id === windowId)?.window ?? null

  const snapshot = await fetchTerraLiveIntel({
    requestedBy: commander.userId,
    bbox: request.nextUrl.searchParams.get('bbox'),
    layers: parseLayers(request.nextUrl.searchParams.get('layers')),
    timeWindow,
  })

  return NextResponse.json({
    tool: 'terra-live-intel',
    status: snapshot.objects.length === 0 ? 'empty' : 'success',
    ...snapshot,
  })
}
