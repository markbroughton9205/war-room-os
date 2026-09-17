import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { fetchProxiedCameraImage, type TerraCameraImageProvider } from '@/lib/terra/cameraImageProxy'
import { isPublicTerraLayer } from '@/lib/terra/publicLayers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PROVIDERS: TerraCameraImageProvider[] = ['digitraffic_road_cameras', 'ontario_511_cameras', 'hong_kong_td_cameras', 'ohgo_cameras', 'caltrans_cctv']

/**
 * Camera still proxy. Client supplies only `provider` + opaque `id` — never a URL.
 * Public / provider-auth stills may be served without a Commander session (401 proceeds).
 * Wrong-identity 403 still blocks. This is not an arbitrary-URL fetcher.
 */
export async function GET(request: NextRequest) {
  const commander = await requireCommanderSession('Terra camera image proxy')
  const provider = request.nextUrl.searchParams.get('provider')
  const id = request.nextUrl.searchParams.get('id')

  if (!commander.ok) {
    if (commander.response.status === 403) return commander.response
    if (!provider || !isPublicTerraLayer(provider)) return commander.response
  }

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
