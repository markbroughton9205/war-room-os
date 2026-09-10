import { pathToFileURL } from 'node:url'
import {
  buildTerraCouncilHandoffPayload,
  buildTerraHandoffEvidencePacket,
  canSendTerraObjectToCouncil,
  evidenceFromTerraHandoff,
  isTerraHandoffBody,
  resolveTerraCouncilLineage,
} from './councilHandoff'
import type { TerraLiveGeoObject } from './liveGeoIntelligence'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-09T20:00:00.000Z'

function vesselObject(overrides: Partial<TerraLiveGeoObject> = {}): TerraLiveGeoObject {
  return {
    id: '230123456',
    layer: 'vessels',
    type: 'vessel_position',
    category: 'maritime',
    title: 'FINNMAID',
    summary: 'Under way using engine',
    latitude: 60.15,
    longitude: 24.95,
    observedAt: '2026-09-09T19:59:50.000Z',
    receivedAt: NOW,
    provider: 'digitraffic_marine',
    publisherFamily: 'fintraffic',
    sourceFamily: 'digitraffic_marine',
    evidenceId: 'digitraffic_marine:230123456',
    discoveryProvenance: { discoveredVia: null, alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
    country: 'FI',
    region: 'Gulf of Finland',
    jurisdiction: 'FI',
    freshness: 'LIVE',
    confidence: 0.9,
    sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456',
    coordinateOrigin: 'source_embedded',
    identityKey: 'mmsi:230123456',
    ...overrides,
  }
}

export function runTerraCouncilHandoffValidation(): CaseResult[] {
  const cases: CaseResult[] = []
  const liveVessel = vesselObject()
  const payload = buildTerraCouncilHandoffPayload({ object: liveVessel })
  const lineage = resolveTerraCouncilLineage(liveVessel)
  const packet = payload ? buildTerraHandoffEvidencePacket(payload) : null
  const evidence = payload ? evidenceFromTerraHandoff(payload) : null

  cases.push(check(
    '13_01_explicit_action_required',
    payload?.action === 'send_selected_object' && lineage?.commanderAction === 'send_selected_object',
    JSON.stringify({ action: payload?.action, commanderAction: lineage?.commanderAction }),
  ))
  cases.push(check(
    '13_02_selected_object_becomes_terra_origin',
    evidence?.origin_type === 'TERRA' && packet?.intelligencePacket?.evidence?.[0]?.origin_type === 'TERRA',
    JSON.stringify({ origin: evidence?.origin_type }),
  ))
  cases.push(check(
    '13_03_provenance_retained',
    evidence?.source_id === 'digitraffic_marine'
      && evidence?.id === 'digitraffic_marine:230123456'
      && evidence?.canonical_url === liveVessel.sourceUrl
      && evidence?.url === liveVessel.sourceUrl,
    JSON.stringify({ source_id: evidence?.source_id, id: evidence?.id, url: evidence?.canonical_url }),
  ))
  cases.push(check(
    '13_04_session_lineage_fields',
    Boolean(
      packet?.findings.includes('objectId=230123456')
      && packet?.findings.includes('provider=digitraffic_marine')
      && packet?.findings.includes('evidenceId=digitraffic_marine:230123456')
      && packet?.honestyNotes?.some(note => /Terra lineage/i.test(note) || /objectId/.test(note)),
    ),
    packet?.findings ?? 'no packet',
  ))
  cases.push(check(
    '13_05_not_text_only',
    Boolean(packet?.intelligencePacket?.evidence?.length === 1 && packet.usedLiveResearch === true),
    String(packet?.intelligencePacket?.evidence?.length),
  ))
  cases.push(check(
    '13_06_no_selection_cannot_send',
    canSendTerraObjectToCouncil(null) === false && resolveTerraCouncilLineage(vesselObject({ latitude: 999 })) === null,
    'blocked',
  ))
  cases.push(check(
    '13_07_unconfigured_ais_never_handoff',
    canSendTerraObjectToCouncil(vesselObject({ provider: 'barentswatch_ais', freshness: 'NEEDS_CREDENTIALS' })) === false
      && canSendTerraObjectToCouncil(vesselObject({ provider: 'aisstream', freshness: 'NEEDS_CREDENTIALS' })) === false
      && canSendTerraObjectToCouncil(vesselObject({ provider: 'aishub_marine', freshness: 'NEEDS_CREDENTIALS' })) === false
      && canSendTerraObjectToCouncil(vesselObject({ freshness: 'HISTORICAL', provider: 'noaa_access_ais' })) === true,
    'credential blockers stay blocked; historical objects may hand off with honest freshness',
  ))
  cases.push(check(
    '13_08_invalid_body_rejected',
    isTerraHandoffBody({}) === false && isTerraHandoffBody(payload) === true,
    'schema',
  ))
  cases.push(check(
    '13_09_no_secrets',
    !/api[_-]?key|Bearer |sk-|commanderUserId/i.test(JSON.stringify(packet)),
    `bytes=${JSON.stringify(packet).length}`,
  ))
  cases.push(check(
    '13_10_does_not_invent_coordinates',
    evidence?.content.includes('60.15000, 24.95000') === true
      && buildTerraCouncilHandoffPayload({ object: vesselObject({ latitude: Number.NaN }) }) === null,
    'coords from selected object only',
  ))
  cases.push(check(
    '13_11_existing_council_packet_shape',
    Boolean(packet?.sources.some(source => source.note === 'terra_selected_object_handoff') && packet?.honestyNotes?.some(note => /not a new parallel Council/i.test(note))),
    JSON.stringify(packet?.sources.map(source => source.note)),
  ))
  cases.push(check(
    '13_12_uses_existing_terra_origin_factory',
    evidence?.origin_type === 'TERRA' && evidence?.source_type === 'direct_fetch',
    JSON.stringify({ origin: evidence?.origin_type, source_type: evidence?.source_type }),
  ))
  const customQuestion = "Analyze this vessel's current observed activity using only the supplied Terra intelligence. Clearly separate observed AIS facts from inference and uncertainty."
  const customPayload = buildTerraCouncilHandoffPayload({ object: liveVessel, commanderPrompt: customQuestion })
  const customPacket = customPayload ? buildTerraHandoffEvidencePacket(customPayload) : null
  cases.push(check(
    '13_13_commander_question_preserved',
    customPayload?.commanderPrompt === customQuestion
      && customPacket?.findings.includes(`commanderQuestion=${customQuestion}`) === true
      && evidenceFromTerraHandoff(customPayload!)?.content.includes(`COMMANDER QUESTION: ${customQuestion}`) === true,
    customPayload?.commanderPrompt ?? 'missing',
  ))
  cases.push(check(
    '13_14_handoff_timestamp_present',
    Boolean(customPayload?.lineage.handedOffAt && customPacket?.findings.includes(`handedOffAt=${customPayload.lineage.handedOffAt}`)),
    customPayload?.lineage.handedOffAt ?? 'missing',
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraCouncilHandoffValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Terra Council intelligence bridge: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
