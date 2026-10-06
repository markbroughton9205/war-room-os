import { US_STATE_ABBREVIATIONS } from '@/lib/terra/geographicContext'
import { isViewportContext } from '@/lib/terra/nearbyActivePoint'
import type { AdminHierarchy, AdminHierarchyLevel, AdminIdentityInput } from './types'

const STATE_ABBR_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_ABBREVIATIONS).map(([name, abbr]) => [abbr.toUpperCase(), name]),
)

export function iso3166_2ForState(countryCode: string | null | undefined, state: string | null | undefined): string | null {
  if (!countryCode || !state) return null
  const cc = countryCode.trim().toUpperCase()
  const raw = state.trim()
  if (!raw) return null
  if (cc === 'US') {
    const abbr = US_STATE_ABBREVIATIONS[raw] ?? (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null)
    return abbr ? `US-${abbr}` : null
  }
  if (/^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/.test(raw)) return raw.toUpperCase()
  return `${cc}-${raw.replace(/\s+/g, '_').toUpperCase()}`
}

export function displayStateName(state: string | null | undefined): string | null {
  if (!state?.trim()) return null
  const raw = state.trim()
  if (/^[A-Za-z]{2}$/.test(raw) && STATE_ABBR_TO_NAME[raw.toUpperCase()]) {
    return STATE_ABBR_TO_NAME[raw.toUpperCase()]
  }
  return raw
}

export function emphasizedLevelForBand(viewBand: AdminIdentityInput['viewBand']): AdminHierarchyLevel | null {
  if (viewBand === 'SPACE' || viewBand === 'GLOBAL' || viewBand === 'CONTINENTAL') return 'COUNTRY'
  if (viewBand === 'REGIONAL') return 'STATE'
  if (viewBand === 'CITY') return 'COUNTY'
  return 'CITY'
}

export function resolveAdminHierarchy(input: Pick<AdminIdentityInput, 'activeLocation' | 'selectedLocation' | 'viewBand' | 'browseMode'>): AdminHierarchy {
  const browseMode = input.browseMode === true || isViewportContext(input.activeLocation?.contextType)
  const loc = browseMode ? null : (input.selectedLocation ?? input.activeLocation)
  if (!loc) {
    return {
      country: null,
      countryCode: null,
      state: null,
      stateCode: null,
      county: null,
      city: null,
      emphasized: null,
      source: browseMode ? 'browse_camera' : 'none',
      browseMode,
    }
  }
  const country = loc.country?.trim() || null
  const countryCode = loc.countryCode?.trim().toUpperCase() || null
  const state = displayStateName(loc.state)
  const county = loc.county?.trim() || null
  const city = loc.city?.trim() || loc.place?.trim() || null
  return {
    country,
    countryCode,
    state,
    stateCode: iso3166_2ForState(countryCode, loc.state),
    county,
    city,
    emphasized: emphasizedLevelForBand(input.viewBand),
    source: 'active_location',
    browseMode: false,
  }
}

export function hierarchyLines(hierarchy: AdminHierarchy): string[] {
  const lines: string[] = []
  if (hierarchy.country) lines.push(hierarchy.country.toUpperCase())
  if (hierarchy.state) lines.push(hierarchy.state.toUpperCase())
  if (hierarchy.county) lines.push(hierarchy.county.toUpperCase())
  if (hierarchy.city && hierarchy.city.toUpperCase() !== hierarchy.county?.toUpperCase()) {
    lines.push(hierarchy.city.toUpperCase())
  }
  return lines
}
