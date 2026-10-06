import { NextResponse } from 'next/server'
import { ADMIN_IDENTITY_CREDIT, ADMIN_IDENTITY_SOURCES } from '@/lib/terra/adminIdentity/sources'
import { listedCountryIsoCodes, listedStateIsoCodes } from '@/lib/terra/adminIdentity/flagCatalog'
import { DEFAULT_ADMIN_SUBMODES, buildAdminIdentityPresentation } from '@/lib/terra/adminIdentity/presentation'
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BANDS: TerraViewBand[] = ['SPACE', 'GLOBAL', 'CONTINENTAL', 'REGIONAL', 'CITY', 'STREET']

export async function GET(request: Request) {
  const url = new URL(request.url)
  const bandRaw = url.searchParams.get('viewBand') ?? 'GLOBAL'
  const viewBand = (BANDS as string[]).includes(bandRaw) ? bandRaw as TerraViewBand : 'GLOBAL'
  const country = url.searchParams.get('country') ?? 'United States'
  const countryCode = url.searchParams.get('countryCode') ?? 'US'
  const state = url.searchParams.get('state') ?? 'Texas'
  const county = url.searchParams.get('county') ?? 'Edwards County'
  const presentation = buildAdminIdentityPresentation({
    viewBand,
    heightMeters: 0,
    activeLocation: {
      country,
      countryCode,
      state,
      county,
      city: url.searchParams.get('city'),
      place: county,
      label: `${county}, ${state}, ${country}`,
      contextType: 'SEARCH',
      latitude: Number(url.searchParams.get('lat') ?? 29.98),
      longitude: Number(url.searchParams.get('lon') ?? -100.3),
    },
    currentTask: 'PLANETARY',
    masterHidden: false,
    subModes: { ...DEFAULT_ADMIN_SUBMODES },
    flagOpacityOverride: null,
  })
  return NextResponse.json({
    status: 'ok',
    layer: 'admin_identity',
    credit: ADMIN_IDENTITY_CREDIT,
    sources: ADMIN_IDENTITY_SOURCES,
    verifiedCountryFlags: listedCountryIsoCodes().length,
    verifiedStateFlags: listedStateIsoCodes().length,
    presentation,
  })
}
