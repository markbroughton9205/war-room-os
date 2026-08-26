/**
 * Cross-checks lib/terra/layerCatalogSummary.ts (the client-safe mirror TerraShell.tsx actually
 * renders from) against the real lib/terra/layerCatalog.ts — the two must never silently drift
 * apart. This file itself is only ever run via plain `node` (never bundled for the browser), so it
 * is the one place allowed to import both. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/layerCatalogSummary.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { TERRA_LAYER_CATALOG } from './layerCatalog'
import { TERRA_LAYER_SUMMARIES } from './layerCatalogSummary'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('summary_and_catalog_have_the_same_length', TERRA_LAYER_SUMMARIES.length === TERRA_LAYER_CATALOG.length, `summary=${TERRA_LAYER_SUMMARIES.length} catalog=${TERRA_LAYER_CATALOG.length}`))

  const catalogById = new Map(TERRA_LAYER_CATALOG.map(l => [l.id, l]))
  const mismatches: string[] = []
  for (const summary of TERRA_LAYER_SUMMARIES) {
    const layer = catalogById.get(summary.id)
    if (!layer) {
      mismatches.push(`${summary.id}: missing from TERRA_LAYER_CATALOG`)
      continue
    }
    if (layer.label !== summary.label) mismatches.push(`${summary.id}: label "${summary.label}" !== "${layer.label}"`)
    if (layer.domain !== summary.domain) mismatches.push(`${summary.id}: domain "${summary.domain}" !== "${layer.domain}"`)
    if (layer.kind !== summary.kind) mismatches.push(`${summary.id}: kind "${summary.kind}" !== "${layer.kind}"`)
    if (layer.description !== summary.description) mismatches.push(`${summary.id}: description text differs`)
  }
  results.push(check('every_summary_entry_matches_its_catalog_entry', mismatches.length === 0, mismatches.join(' | ')))

  const catalogIds = new Set(TERRA_LAYER_CATALOG.map(l => l.id))
  const summaryIds = new Set(TERRA_LAYER_SUMMARIES.map(l => l.id))
  const missingFromSummary = [...catalogIds].filter(id => !summaryIds.has(id))
  results.push(check('no_catalog_layer_is_missing_from_the_client_safe_summary', missingFromSummary.length === 0, `missing=${missingFromSummary.join(',')}`))

  return results
}

export function runTerraLayerCatalogSummaryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraLayerCatalogSummaryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra layerCatalogSummary validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
