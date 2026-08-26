/**
 * Structural validation for the Terra layer catalog itself — catches a duplicated layer id, a
 * kind/domain combination that drifted from what TERRA_INTELLIGENCE_EVENT_KINDS/
 * TERRA_INTELLIGENCE_DOMAINS actually declare, or a layer missing a real default query where its
 * provider requires one. Deliberately does not call any provider — this is a shape check over the
 * catalog data, not a live/network test. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/layerCatalog.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { TERRA_LAYER_CATALOG } from './layerCatalog'
import { TERRA_INTELLIGENCE_DOMAINS, TERRA_INTELLIGENCE_EVENT_KINDS } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Providers confirmed (during Phase 3/4 live investigation) to require a real, non-empty query
// text with no meaningful zero-auth "give me anything" default — a blank defaultQueryText for one
// of these would silently produce an always-empty layer.
const REQUIRES_NON_EMPTY_QUERY_TEXT = new Set([
  'usgs_water', 'opensky', 'idai_gazetteer', 'nominatim', 'pleiades', 'whg',
  'osm_overpass', 'ohm_overpass', 'met_no', 'open_meteo', 'obis', 'gbif', 'edh',
  'nasa_eonet', 'nws_weather',
])

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('catalog_is_non_empty', TERRA_LAYER_CATALOG.length > 0, `length=${TERRA_LAYER_CATALOG.length}`))

  const ids = TERRA_LAYER_CATALOG.map(l => l.id)
  results.push(check('layer_ids_are_unique', new Set(ids).size === ids.length, `ids=${ids.join(',')}`))

  const badKind = TERRA_LAYER_CATALOG.find(l => !(TERRA_INTELLIGENCE_EVENT_KINDS as readonly string[]).includes(l.kind))
  results.push(check('every_layer_kind_is_a_declared_event_kind', !badKind, `offender=${badKind?.id}`))

  const badDomain = TERRA_LAYER_CATALOG.find(l => !(TERRA_INTELLIGENCE_DOMAINS as readonly string[]).includes(l.domain))
  results.push(check('every_layer_domain_is_a_declared_domain', !badDomain, `offender=${badDomain?.id}`))

  const badQuery = TERRA_LAYER_CATALOG.find(l => REQUIRES_NON_EMPTY_QUERY_TEXT.has(l.providerId) && l.defaultQueryText.trim().length === 0)
  results.push(check('providers_requiring_query_text_have_a_real_default', !badQuery, `offender=${badQuery?.id}`))

  const badLabel = TERRA_LAYER_CATALOG.find(l => !l.label.trim() || !l.description.trim())
  results.push(check('every_layer_has_a_real_label_and_description', !badLabel, `offender=${badLabel?.id}`))

  const missingNormalize = TERRA_LAYER_CATALOG.find(l => typeof l.normalize !== 'function')
  results.push(check('every_layer_declares_a_normalize_function', !missingNormalize, `offender=${missingNormalize?.id}`))

  // The one Phase 4 ENTITY_GEO_RESOLVABLE layer must be present and correctly declared distinct
  // from the LATENT_GEO_SAFE layers around it.
  const edh = TERRA_LAYER_CATALOG.find(l => l.id === 'edh')
  results.push(check('edh_geo_resolution_layer_is_cataloged', edh?.providerId === 'edh' && edh?.kind === 'heritage_site', `edh=${JSON.stringify(edh)}`))

  // Phase 5: hazard layers with genuinely different update cadences must declare a distinct,
  // source-appropriate refreshIntervalMs — not silently share one fixed rate.
  const nhc = TERRA_LAYER_CATALOG.find(l => l.id === 'nhc_current_storms')
  const eonetWildfires = TERRA_LAYER_CATALOG.find(l => l.id === 'nasa_eonet_wildfires')
  results.push(check('hazard_layers_with_slower_cadences_declare_a_refresh_override', typeof nhc?.refreshIntervalMs === 'number' && typeof eonetWildfires?.refreshIntervalMs === 'number', `nhc=${nhc?.refreshIntervalMs} eonet=${eonetWildfires?.refreshIntervalMs}`))
  results.push(check('refresh_overrides_are_not_all_identical_to_each_other', nhc?.refreshIntervalMs !== eonetWildfires?.refreshIntervalMs, `nhc=${nhc?.refreshIntervalMs} eonet=${eonetWildfires?.refreshIntervalMs}`))

  const badRefresh = TERRA_LAYER_CATALOG.find(l => typeof l.refreshIntervalMs === 'number' && l.refreshIntervalMs < 60_000)
  results.push(check('no_refresh_interval_is_faster_than_a_reasonable_floor', !badRefresh, `offender=${badRefresh?.id} refreshIntervalMs=${badRefresh?.refreshIntervalMs}`))

  return results
}

export function runTerraLayerCatalogValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraLayerCatalogValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra layerCatalog validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
