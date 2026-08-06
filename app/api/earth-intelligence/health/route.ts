import { NextResponse } from 'next/server'
import { getGibsServerConfigStatus } from '@/lib/earth-intelligence/gibsServerConfig'
import { PUBLIC_GIBS_WMTS_BASE_URL } from '@/lib/earth-intelligence/gibsTileUrl'

export const dynamic = 'force-dynamic'

/**
 * Read-only diagnostic for the earth-intelligence env wiring. Reports
 * whether NASA_GIBS_WMTS_BASE_URL is present — never its value. GIBS takes
 * no API key, so there is no secret-presence boolean to report here.
 * Session-gated by default middleware, same as other dashboard routes; not
 * added to the public API exemption list.
 */
export async function GET() {
  const status = getGibsServerConfigStatus()
  return NextResponse.json({
    ok: true,
    publicBaseUrl: PUBLIC_GIBS_WMTS_BASE_URL,
    envBaseUrlConfigured: status.baseUrlConfigured,
  })
}
