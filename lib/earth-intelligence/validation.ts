import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GIBS_LAYERS, getGibsLayer } from '@/lib/earth-intelligence/gibsLayers'
import {
  EARLIEST_PLAUSIBLE_GIBS_DATE,
  PUBLIC_GIBS_WMTS_BASE_URL,
  buildGibsTileUrlTemplate,
  isRequestableIsoDate,
  isValidIsoDate,
} from '@/lib/earth-intelligence/gibsTileUrl'
import { getGibsServerConfigStatus } from '@/lib/earth-intelligence/gibsServerConfig'

export type EarthIntelligenceValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): EarthIntelligenceValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Focused, permanent validation suite for the /earth-intelligence feature.
 * Follows the repo's established validation-runner convention (see
 * lib/opportunity-agents/uiTruthValidation.ts): pure-function cases call the
 * real exported logic directly; cases about async/DOM behavior that this
 * repo has no jsdom/testing-library to execute (opacity not rebuilding the
 * tile layer, the stall timeout never claiming false success, stale
 * callbacks being ignored) are verified as structural source-truth checks
 * against the actual component file, the same technique
 * uiTruthValidation.ts already uses for React wiring it can't execute.
 */
export function runEarthIntelligenceValidation(): EarthIntelligenceValidationResult[] {
  const mapSource = readFileSync(
    join(process.cwd(), 'components/earth-intelligence/EarthIntelligenceMap.tsx'),
    'utf8',
  )
  const healthRouteSource = readFileSync(
    join(process.cwd(), 'app/api/earth-intelligence/health/route.ts'),
    'utf8',
  )
  const envExampleSource = readFileSync(join(process.cwd(), '.env.example'), 'utf8')

  const availableLayers = GIBS_LAYERS.filter(layer => layer.status === 'available')
  const fires = getGibsLayer('fires')

  return [
    // 1. Every registered raster layer builds the expected host and path shape.
    test('tile_01_available_layers_build_expected_url_shape', () => {
      for (const layer of availableLayers) {
        const url = buildGibsTileUrlTemplate(layer.id, layer.defaultDate ?? '2020-01-01')
        if (!url.startsWith(PUBLIC_GIBS_WMTS_BASE_URL)) return `${layer.id} url did not start with the public GIBS host`
        if (!url.includes(`/${encodeURIComponent(layer.identifier)}/default/`)) {
          return `${layer.id} url missing /{identifier}/default/ path segment`
        }
        if (!url.endsWith(`/{z}/{y}/{x}.${layer.tileFormat}`)) return `${layer.id} url missing {z}/{y}/{x}.${layer.tileFormat} suffix`
      }
      return true
    }),

    // 2. Unknown layer IDs fail closed.
    test('tile_02_unknown_layer_id_fails_closed', () => {
      try {
        buildGibsTileUrlTemplate('not-a-registered-layer', '2026-01-01')
        return 'expected buildGibsTileUrlTemplate to throw for an unregistered layer id'
      } catch {
        return true
      }
    }),

    // 3. Arbitrary hosts cannot be supplied.
    test('tile_03_host_is_fixed_and_cannot_be_overridden', () => {
      if (!/^https:\/\/gibs\.earthdata\.nasa\.gov\//.test(PUBLIC_GIBS_WMTS_BASE_URL)) {
        return 'PUBLIC_GIBS_WMTS_BASE_URL is not the expected NASA GIBS host'
      }
      // buildGibsTileUrlTemplate's public signature is (layerId: string, isoDate: string) —
      // there is no parameter through which a caller can pass a host/URL fragment.
      for (const layer of availableLayers) {
        const url = buildGibsTileUrlTemplate(layer.id, layer.defaultDate ?? '2020-01-01')
        if (!url.startsWith(PUBLIC_GIBS_WMTS_BASE_URL)) return `${layer.id} url did not use the fixed public host`
      }
      return true
    }),

    // 4. Raster extensions match the registry.
    test('tile_04_extension_matches_registered_format', () => {
      for (const layer of availableLayers) {
        if (!layer.tileFormat) return `${layer.id} is available but has no tileFormat`
        const url = buildGibsTileUrlTemplate(layer.id, layer.defaultDate ?? '2020-01-01')
        if (!url.endsWith(`.${layer.tileFormat}`)) return `${layer.id} url extension does not match registered tileFormat`
      }
      return true
    }),

    // 5. Fires remains explicitly vector and unavailable in Phase 1.
    test('tile_05_fires_is_vector_and_unavailable', () => {
      if (!fires) return 'fires layer missing from registry'
      if (fires.status !== 'unavailable') return 'fires layer is not marked unavailable'
      const reason = (fires.unavailableReason ?? '').toLowerCase()
      if (!reason.includes('vector') || !reason.includes('mapbox-vector-tile')) {
        return 'fires unavailableReason does not document the vector-tile format'
      }
      try {
        buildGibsTileUrlTemplate('fires', '2026-01-01')
        return 'buildGibsTileUrlTemplate unexpectedly built a URL for the unavailable fires layer'
      } catch {
        return true
      }
    }),

    // 6. Valid leap dates are accepted.
    test('date_06_valid_leap_day_accepted', () => isValidIsoDate('2024-02-29') || 'leap day 2024-02-29 incorrectly rejected'),

    // 7. Invalid leap dates are rejected.
    test('date_07_invalid_leap_day_rejected', () => !isValidIsoDate('2023-02-29') || '2023-02-29 (not a leap year) incorrectly accepted'),

    // 8. Impossible calendar dates are rejected.
    test('date_08_impossible_calendar_dates_rejected', () => {
      const impossible = ['2023-02-30', '2023-13-01', '2023-04-31', '2023-00-10']
      for (const value of impossible) {
        if (isValidIsoDate(value)) return `${value} incorrectly accepted as valid`
      }
      return true
    }),

    // 9. Future dates are rejected.
    test('date_09_future_dates_rejected', () => !isRequestableIsoDate('2999-01-01') || 'far-future date incorrectly requestable'),

    // 10. Dates before the broad minimum are rejected; the minimum itself is requestable.
    test('date_10_before_broad_minimum_rejected', () => {
      if (isRequestableIsoDate('1999-12-31')) return 'date before EARLIEST_PLAUSIBLE_GIBS_DATE incorrectly requestable'
      if (!isRequestableIsoDate(EARLIEST_PLAUSIBLE_GIBS_DATE)) return 'the floor date itself was rejected'
      return true
    }),

    // 11. Opacity changes do not rebuild the tile-layer request configuration.
    test('client_11_opacity_excluded_from_tile_swap_deps', () => {
      const effectMatch = mapSource.match(/useEffect\(\(\) => \{[\s\S]*?layer\.addTo\(map\)[\s\S]*?\}, \[([^\]]*)\]\)/)
      if (!effectMatch) return 'could not locate the tile-swap effect and its dependency array'
      const deps = effectMatch[1]!
      if (/\bopacity\b/.test(deps)) return `opacity is present in the tile-swap effect dependency array: [${deps}]`
      const opacityEffect = mapSource.match(/useEffect\(\(\) => \{\s*tileLayerRef\.current\?\.setOpacity\(opacity\)\s*\}, \[opacity\]\)/)
      if (!opacityEffect) return 'dedicated setOpacity(opacity)-only effect not found'
      return true
    }),

    // 12. Timeout alone cannot produce success.
    test('client_12_stall_timeout_cannot_claim_unconditional_success', () => {
      const stallMatch = mapSource.match(/window\.setTimeout\(\(\) => \{[\s\S]*?\}, STALL_TIMEOUT_MS\)/)
      if (!stallMatch) return 'could not locate the stall timeout handler'
      const body = stallMatch[0]
      if (!/loadTallyRef\.current\.loaded > 0 \? 'ok' : 'stalled'/.test(body)) {
        return 'stall timeout does not gate its outcome on a confirmed tile load count'
      }
      if (/current === 'loading' \? 'ok'/.test(body)) return 'stall timeout still contains the old unconditional-success pattern'
      return true
    }),

    // 13. Success requires a tile-load event — including the edge case where
    // Leaflet's 'load' event fires with zero tiles ever having loaded or
    // errored (e.g. a zero-size tile range before layout settles). This
    // asserts the *absence* of a false-success fallback, not just the
    // presence of a happy-path string, so it can't be satisfied by the
    // literal bug it exists to catch.
    test('client_13_success_requires_confirmed_tileload', () => {
      const loadHandlerMatch = mapSource.match(/layer\.on\('load', \(\) => \{[\s\S]*?\}\)/)
      if (!loadHandlerMatch) return "could not locate the layer 'load' handler"
      const body = loadHandlerMatch[0]
      if (!/loaded > 0 \? 'ok' : 'error'/.test(body) && !/loadTallyRef\.current\.loaded > 0 \? 'ok' : 'error'/.test(body)) {
        return "'load' handler does not gate the ok branch on a confirmed loaded count with a non-'ok' fallback"
      }
      if (/errored > 0 \? 'error' : 'ok'\)/.test(body)) {
        return "'load' handler still falls through to 'ok' when zero tiles were confirmed loaded or errored"
      }
      return true
    }),

    // 14. Fully failed requests produce an unavailable/error state.
    test('client_14_fully_failed_requests_shown_as_error', () => {
      if (!/type LoadState = 'loading' \| 'ok' \| 'error' \| 'stalled'/.test(mapSource)) {
        return 'LoadState no longer includes a distinct error state'
      }
      if (!/displayState === 'error'/.test(mapSource)) return "no UI branch renders the 'error' state"
      return true
    }),

    // 15. Stale callbacks cannot update a newer request (request-generation guard).
    test('client_15_stale_callbacks_guarded_by_request_id', () => {
      const guardOccurrences = mapSource.match(/requestIdRef\.current !== requestId/g) ?? []
      // One guard each for: loading, tileload, tileerror, load, and the stall timeout.
      if (guardOccurrences.length < 5) {
        return `expected at least 5 request-id guards (loading/tileload/tileerror/load/stallTimeout), found ${guardOccurrences.length}`
      }
      if (!/const requestId = \+\+requestIdRef\.current/.test(mapSource)) return 'request id is not incremented per tile-layer request'
      return true
    }),

    // 16. Health output contains no secret or environment value.
    test('health_16_no_secret_or_env_value_in_response', () => {
      const status = getGibsServerConfigStatus()
      for (const [key, value] of Object.entries(status)) {
        if (typeof value !== 'boolean') return `gibsServerConfig status field "${key}" is not a boolean (got ${typeof value})`
      }
      if (/process\.env\.[A-Z_]+\s*[,}]/.test(healthRouteSource.replace(/getGibsServerConfigStatus|PUBLIC_GIBS_WMTS_BASE_URL/g, ''))) {
        return 'health route appears to reference a raw process.env value directly'
      }
      return true
    }),

    // 17. Only safe configuration status is returned (no NASA_API_KEY, no boolean-of-a-secret).
    test('health_17_response_shape_is_the_safe_allowlist', () => {
      if (healthRouteSource.includes('NASA_API_KEY')) return 'health route still references NASA_API_KEY'
      if (healthRouteSource.includes('envApiKeyPresent')) return 'health route still exposes an envApiKeyPresent field'
      const status = getGibsServerConfigStatus()
      const keys = Object.keys(status).sort()
      if (keys.join(',') !== 'baseUrlConfigured') return `unexpected gibsServerConfig status keys: ${keys.join(',')}`
      return true
    }),

    // 18. No NEXT_PUBLIC NASA credential exists anywhere, and NASA_API_KEY is gone from .env.example.
    test('secret_18_no_next_public_nasa_credential', () => {
      if (envExampleSource.includes('NASA_API_KEY')) return '.env.example still references NASA_API_KEY'
      if (mapSource.includes('NEXT_PUBLIC_NASA')) return 'client map component references a NEXT_PUBLIC NASA credential'
      if (healthRouteSource.includes('NEXT_PUBLIC_NASA')) return 'health route references a NEXT_PUBLIC NASA credential'
      return true
    }),
  ]
}
