import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { fetchProxiedCameraImage, type TerraCameraImageProvider } from '@/lib/terra/cameraImageProxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PROVIDERS: TerraCameraImageProvider[] = ['digitraffic_road_cameras', 'ontario_511_cameras', 'hong_kong_td_cameras']

/**
 * God's Eye Phase 2's camera-image proxy boundary — see lib/terra/cameraImageProxy.ts for the full
 * security rationale. Same Commander-session gate every other Terra API route uses
 * (app/api/terra/layers/[layerId]/route.ts); this route adds no separate auth path.
 *
 * GET /api/terra/camera-image?provider=digitraffic_road_cameras&id={presetId}
 * GET /api/terra/camera-image?provider=ontario_511_cameras&id={viewId}
 * GET /api/terra/camera-image?provider=hong_kong_td_cameras&id={cameraKey}
 *
 * `id` is the only client-supplied identifier — never a URL — so this route has no
 * arbitrary-URL-proxying surface regardless of what a caller sends.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra camera image proxy')
  if (!commander.ok) return commander.response

  const provider = request.nextUrl.searchParams.get('provider')
  const id = request.nextUrl.searchParams.get('id')

  if (!provider || !ALLOWED_PROVIDERS.includes(provider as TerraCameraImageProvider)) {
    return NextResponse.json({ error: `Unknown or unsupported camera image provider. Allowed: ${ALLOWED_PROVIDERS.join(', ')}.` }, { status: 400 })
  }
  if (!id) {
    return NextResponse.json({ error: 'Missing required "id" query parameter.' }, { status: 400 })
  }

  const result = await fetchProxiedCameraImage(provider as TerraCameraImageProvider, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status && result.status >= 400 && result.status < 600 ? result.status : 502 })
  }

  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      'content-type': result.contentType,
      // Short — matches this codebase's "respect provider refresh cadence" requirement rather
      // than caching a camera still longer than the source itself refreshes it.
      'cache-control': 'private, max-age=20',
      'x-terra-camera-source-url': result.sourceUrl,
      'x-terra-camera-attribution': result.attribution,
    },
  })
}
