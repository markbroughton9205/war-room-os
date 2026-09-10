import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeCouncilChatRequest } from '@/app/api/chat/execute'
import { buildTerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import { observedVesselFromSelection } from './observedVessel'
import {
  createAstraLiveMission,
  markAstraMissionCompleted,
  markAstraMissionFailed,
  buildAstraCouncilChatBody,
  extractAstraCouncilOutcome,
} from './liveMission'
import {
  claimAstraMissionRunning,
  createAstraCouncilConversation,
  getAstraLiveMission,
  resetAstraMissionStoreProbe,
  saveAstraLiveMission,
} from './liveMission.store'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import type { TerraGeoFeature } from '@/lib/terra/types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = new Date().toISOString()
const OBJECTIVE = "Analyze this vessel's current observed activity using only the supplied Terra intelligence. Clearly separate observed AIS facts from inference and uncertainty."

function vessel(): TerraLiveGeoObject {
  return {
    id: '230685000',
    layer: 'vessels',
    type: 'vessel_position',
    category: 'maritime',
    title: 'FINBO CARGO',
    summary: 'Under way using engine',
    latitude: 60.10786,
    longitude: 25.19068,
    observedAt: NOW,
    receivedAt: NOW,
    provider: 'digitraffic_marine',
    publisherFamily: 'fintraffic',
    sourceFamily: 'digitraffic_marine',
    evidenceId: 'digitraffic_marine:230685000',
    discoveryProvenance: { discoveredVia: null, alsoDiscoveredVia: [], upstreamEngines: [], storageOrigin: null },
    country: 'FI',
    region: 'Gulf of Finland',
    jurisdiction: 'FI',
    freshness: 'LIVE',
    confidence: 0.9,
    sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000',
    coordinateOrigin: 'source_embedded',
    identityKey: 'mmsi:230685000',
  }
}

function vesselFeature(): TerraGeoFeature {
  return {
    id: '230685000',
    eventId: 'digitraffic_marine:230685000',
    providerId: 'digitraffic_marine',
    kind: 'vessel_position',
    longitude: 25.19068,
    latitude: 60.10786,
    altitude: null,
    timestamp: NOW,
    title: 'FINBO CARGO',
    summary: 'Under way using engine',
    properties: { mmsi: '230685000', speedKnots: 12.4, navStatLabel: 'Under way using engine' },
    provenance: { provider: 'digitraffic_marine', sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000', retrievedAt: NOW, fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: '230685000', canonicalUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000' },
    coordinateOrigin: 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
  }
}

export async function runAstraLiveMissionLiveAcceptance(): Promise<{ results: CaseResult[]; proof: Record<string, unknown> }> {
  const results: CaseResult[] = []
  const tmp = mkdtempSync(path.join(tmpdir(), 'wr-astra-live-'))
  const previousDir = process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
  const previousForce = process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
  process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = tmp
  process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = '1'
  resetAstraMissionStoreProbe()

  const seed = buildTerraCouncilHandoffPayload({
    object: vessel(),
    feature: vesselFeature(),
    commanderPrompt: OBJECTIVE,
  })
  const created = createAstraLiveMission({
    commanderUserId: 'live-acceptance-commander',
    objective: OBJECTIVE,
    terraSeed: seed,
    observedVessel: observedVesselFromSelection({ object: vessel(), feature: vesselFeature() }),
  })
  if (!created) {
    return { results: [check('live_create', false, 'create failed')], proof: {} }
  }
  const stored = await saveAstraLiveMission(created)
  resetAstraMissionStoreProbe()
  const reopened = await getAstraLiveMission(stored.id)
  results.push(check('live_restart_persistence', Boolean(reopened && reopened.objective === OBJECTIVE && reopened.status === 'planned'), reopened?.id ?? 'missing'))

  const failMission = await saveAstraLiveMission(createAstraLiveMission({
    commanderUserId: 'live-acceptance-commander',
    objective: OBJECTIVE,
    terraSeed: seed,
  })!)
  const failClaim = await claimAstraMissionRunning({ id: failMission.id, commanderUserId: 'live-acceptance-commander' })
  const failed = failClaim.ok
    ? await saveAstraLiveMission(markAstraMissionFailed(failClaim.mission, 'Controlled Council execution failure'))
    : null
  results.push(check('live_controlled_failure', failed?.status === 'failed' && failed.error === 'Controlled Council execution failure', failed?.status ?? 'missing'))

  const proof: Record<string, unknown> = {
    missionId: stored.id,
    objective: stored.objective,
    terraObjectId: stored.terraSeed?.lineage.objectId ?? null,
    terraProvider: stored.terraSeed?.lineage.provider ?? null,
    terraEvidenceId: stored.terraSeed?.lineage.evidenceId ?? null,
    constellationSpawned: false,
    astraProvidesSubstantiveAnswer: false,
  }

  const claimed = await claimAstraMissionRunning({ id: stored.id, commanderUserId: 'live-acceptance-commander' })
  results.push(check('live_claim_running', claimed.ok && claimed.ok && claimed.mission.status === 'running', claimed.ok ? claimed.mission.status : 'not claimed'))
  if (!claimed.ok) {
    if (previousDir === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
    else process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = previousDir
    if (previousForce === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
    else process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = previousForce
    resetAstraMissionStoreProbe()
    rmSync(tmp, { recursive: true, force: true })
    return { results, proof }
  }

  let running = claimed.mission
  const conversationIdForRun = running.councilConversationId ?? await createAstraCouncilConversation(running)
  if (conversationIdForRun) {
    running = await saveAstraLiveMission({ ...running, councilConversationId: conversationIdForRun })
  }

  const started = Date.now()
  const councilRequest = new Request('http://war-room.local/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildAstraCouncilChatBody(running, conversationIdForRun)),
  })
  const councilResponse = await executeCouncilChatRequest(councilRequest)
  const payload = await councilResponse.json().catch(() => ({})) as Record<string, unknown>
  const durationMs = Date.now() - started
  const outcome = extractAstraCouncilOutcome(payload)
  outcome.meta.durationMs = durationMs
  const conversationId = outcome.conversationId ?? conversationIdForRun
  const answer = outcome.text
  const failedRun = !councilResponse.ok || typeof payload.error === 'string' || !answer
  proof.councilStatus = councilResponse.status
  proof.councilDurationMs = durationMs
  proof.councilConversationId = conversationId
  proof.councilError = typeof payload.error === 'string' ? payload.error : null
  proof.councilRoster = outcome.meta.roster
  proof.councilStages = outcome.meta.stages
  proof.familyDeliberationPresent = Boolean(payload.familyDeliberation)
  proof.synthesisPresent = outcome.meta.synthesisPresent
  proof.answerPreview = answer.slice(0, 240)
  proof.payloadKeys = Object.keys(payload)

  if (failedRun) {
    const failedMission = await saveAstraLiveMission(markAstraMissionFailed(
      running,
      typeof payload.error === 'string' ? payload.error : `Council execution failed (${councilResponse.status})`,
    ))
    results.push(check('live_council_completed', false, failedMission.error ?? 'failed'))
    proof.finalStatus = failedMission.status
  } else {
    const completed = await saveAstraLiveMission(markAstraMissionCompleted(running, {
      councilConversationId: conversationId,
      outcomeSummary: answer.slice(0, 800),
      councilExecution: outcome.meta,
    }))
    const persisted = await getAstraLiveMission(completed.id)
    results.push(check(
      'live_council_completed',
      persisted?.status === 'completed' && persisted.objective === OBJECTIVE && persisted.astraProvidesSubstantiveAnswer === false,
      persisted?.status ?? 'missing',
    ))
    results.push(check(
      'live_conversation_lineage',
      Boolean(persisted?.councilConversationId || conversationId === null),
      persisted?.councilConversationId ?? 'no conversation id from Council payload',
    ))
    results.push(check(
      'live_terra_lineage_retained',
      persisted?.terraSeed?.lineage.provider === 'digitraffic_marine' && persisted.terraSeed.lineage.objectId === '230685000',
      persisted?.terraSeed?.lineage.provider ?? 'missing',
    ))
    proof.finalStatus = persisted?.status ?? null
    proof.persistedConversationId = persisted?.councilConversationId ?? null
  }

  if (previousDir === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
  else process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = previousDir
  if (previousForce === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
  else process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = previousForce
  resetAstraMissionStoreProbe()
  mkdirSync(path.join(process.cwd(), 'work', 'build14'), { recursive: true })
  writeFileSync(path.join(process.cwd(), 'work', 'build14', 'live-council-proof.json'), JSON.stringify(proof, null, 2))
  rmSync(tmp, { recursive: true, force: true })
  return { results, proof }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results, proof } = await runAstraLiveMissionLiveAcceptance()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`ASTRA live acceptance proof durationMs=${String(proof.councilDurationMs ?? 'n/a')} status=${String(proof.finalStatus ?? 'n/a')}`)
  const failed = results.filter(result => !result.pass)
  console.log(`ASTRA live mission live-acceptance: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
