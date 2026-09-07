import { pathToFileURL } from 'node:url'
import { normalizeSourceEvidence, type RawIntelligenceSourceRecord } from './sourceNormalizer'
import {
  buildModelInferenceEvidenceItem,
  buildRuntimeTelemetryEvidenceItem,
  buildTerraEvidenceItem,
} from './evidenceOrigin'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

export function runEvidenceOriginValidation(): CaseResult[] {
  const cases: CaseResult[] = []
  const now = '2026-09-07T12:00:00.000Z'

  const rawSources: RawIntelligenceSourceRecord[] = [
    {
      source_id: 'public_news_rss',
      ok: true,
      queried_at: now,
      findings: [{ title: 'Freight rates rise', content: 'Spot rates increased 4% week over week.', observed_at: now }],
    },
  ]
  const liveWebItems = normalizeSourceEvidence(rawSources, now)
  const liveWebItem = liveWebItems[0]

  cases.push(check(
    'origin_01_live_web_tagged_by_normalizer',
    liveWebItem?.origin_type === 'LIVE_WEB',
    JSON.stringify({ origin_type: liveWebItem?.origin_type }),
  ))
  cases.push(check(
    'origin_02_source_type_preserved_alongside_origin_type',
    typeof liveWebItem?.source_type === 'string' && liveWebItem.source_type.length > 0,
    JSON.stringify({ source_type: liveWebItem?.source_type }),
  ))

  const terraItem = buildTerraEvidenceItem({ terraContextText: 'Lagos, Nigeria — 6.5244, 3.3792', observedAt: now })
  const runtimeItem = buildRuntimeTelemetryEvidenceItem({
    claim: 'Ollama is online and responded normally this round.',
    content: 'Ollama is online and responded normally this round.',
    observedAt: now,
  })
  const modelInferenceItem = buildModelInferenceEvidenceItem({
    claim: 'This is likely a seasonal trend.',
    content: 'This is likely a seasonal trend.',
    observedAt: now,
  })

  cases.push(check(
    'origin_03_terra_item_tagged_terra',
    terraItem.origin_type === 'TERRA',
    JSON.stringify({ origin_type: terraItem.origin_type }),
  ))
  cases.push(check(
    'origin_04_runtime_telemetry_item_tagged_correctly',
    runtimeItem.origin_type === 'RUNTIME_TELEMETRY',
    JSON.stringify({ origin_type: runtimeItem.origin_type }),
  ))
  cases.push(check(
    'origin_05_model_inference_item_tagged_correctly',
    modelInferenceItem.origin_type === 'MODEL_INFERENCE',
    JSON.stringify({ origin_type: modelInferenceItem.origin_type }),
  ))

  const originTypesSeen = new Set([liveWebItem?.origin_type, terraItem.origin_type, runtimeItem.origin_type, modelInferenceItem.origin_type])
  cases.push(check(
    'origin_06_all_four_origins_are_mutually_distinct',
    originTypesSeen.size === 4,
    JSON.stringify({ originTypesSeen: Array.from(originTypesSeen) }),
  ))

  cases.push(check(
    'origin_07_live_web_item_never_identifies_as_terra',
    liveWebItem?.origin_type !== 'TERRA',
    JSON.stringify({ origin_type: liveWebItem?.origin_type }),
  ))

  cases.push(check(
    'origin_08_terra_item_never_identifies_as_live_web',
    terraItem.origin_type !== 'LIVE_WEB',
    JSON.stringify({ origin_type: terraItem.origin_type }),
  ))

  cases.push(check(
    'origin_09_no_item_fabricates_kimi_wave_or_stored_research',
    [liveWebItem?.origin_type, terraItem.origin_type, runtimeItem.origin_type, modelInferenceItem.origin_type]
      .every(origin => origin !== 'KIMI_WAVE' && origin !== 'STORED_RESEARCH'),
    JSON.stringify({ origins: [liveWebItem?.origin_type, terraItem.origin_type, runtimeItem.origin_type, modelInferenceItem.origin_type] }),
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runEvidenceOriginValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Evidence origin validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
