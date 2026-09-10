import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  astraExecuteConflict,
  astraMissionContainsSecrets,
  astraMissionPublicView,
  createAstraLiveMission,
  markAstraMissionCompleted,
  markAstraMissionFailed,
  markAstraMissionRunning,
  normalizeAstraObjective,
} from './liveMission'
import {
  claimAstraMissionRunning,
  describeAstraMissionStore,
  getAstraLiveMission,
  listAstraLiveMissions,
  resetAstraMissionStoreProbe,
  saveAstraLiveMission,
} from './liveMission.store'
import { canSendTerraObjectToCouncil, buildTerraCouncilHandoffPayload } from '@/lib/terra/councilHandoff'
import { observedVesselFromSelection } from './observedVessel'
import type { TerraLiveGeoObject } from '@/lib/terra/liveGeoIntelligence'
import type { TerraGeoFeature } from '@/lib/terra/types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-10T01:40:00.000Z'

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
    observedAt: '2026-09-10T01:23:24.734Z',
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
    timestamp: '2026-09-10T01:23:24.734Z',
    title: 'FINBO CARGO',
    summary: 'Under way using engine',
    properties: {
      mmsi: '230685000',
      imo: '9264727',
      speedKnots: 12.4,
      courseDeg: 271,
      headingDeg: 270,
      navStatLabel: 'Under way using engine',
    },
    provenance: {
      provider: 'digitraffic_marine',
      sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000',
      retrievedAt: NOW,
      fromCache: false,
      isHistorical: false,
    },
    rawReference: {
      documentId: null,
      providerRecordId: '230685000',
      canonicalUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230685000',
    },
    coordinateOrigin: 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
  }
}

function sourceContains(file: string, pattern: RegExp): boolean {
  return pattern.test(readFileSync(path.join(process.cwd(), file), 'utf8'))
}

export async function runAstraLiveMissionValidation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const seed = buildTerraCouncilHandoffPayload({ object: vessel(), feature: vesselFeature() })
  const observedVessel = observedVesselFromSelection({ object: vessel(), feature: vesselFeature() })
  const created = createAstraLiveMission({
    commanderUserId: 'commander-test',
    objective: "Analyze this vessel's current observed activity using only the supplied Terra intelligence.",
    terraSeed: seed,
    observedVessel,
    nowIso: NOW,
  })

  cases.push(check('14_01_explicit_create_required', Boolean(created && created.status === 'planned'), created?.status ?? 'missing'))
  cases.push(check('14_02_selection_does_not_create_mission', canSendTerraObjectToCouncil(vessel()) === true && createAstraLiveMission({ commanderUserId: 'x', objective: '' }) === null, 'selection alone is not create'))
  cases.push(check('14_03_blank_objective_rejected', normalizeAstraObjective('   ') === null, 'objective required'))
  cases.push(check('14_04_astra_does_not_answer', created?.astraProvidesSubstantiveAnswer === false && created?.plan?.astraProvidesSubstantiveAnswer === false, String(created?.astraProvidesSubstantiveAnswer)))
  cases.push(check('14_05_constellation_not_spawned', created?.constellationSpawned === false && created?.constellation?.status === 'planned', created?.constellation?.status ?? 'missing'))
  cases.push(check('14_06_uses_existing_decompose_plan', Boolean(created?.plan?.selectedPermanentSeats.length && created.plan.missionId.startsWith('mission-')), JSON.stringify(created?.plan?.selectedPermanentSeats)))
  cases.push(check('14_07_terra_seed_retained_not_source_family_swap', created?.terraSeed?.lineage.provider === 'digitraffic_marine' && created?.terraSeed?.lineage.objectId === '230685000', created?.terraSeed?.lineage.provider ?? 'missing'))
  cases.push(check('14_08_create_is_not_execute', created?.startedAt === null && created?.status === 'planned', created?.status ?? 'missing'))
  const running = created ? markAstraMissionRunning(created, NOW) : null
  cases.push(check('14_09_execute_is_explicit_status_change', running?.status === 'running' && created?.status === 'planned', running?.status ?? 'missing'))
  const failed = running ? markAstraMissionFailed(running, 'Controlled Council execution failure', NOW) : null
  cases.push(check('14_10_failure_does_not_corrupt_lineage', failed?.status === 'failed' && failed.terraSeed?.lineage.objectId === '230685000' && failed.constellationSpawned === false && failed.failedAt === NOW, failed?.error ?? 'missing'))
  cases.push(check('14_11_no_secrets', created ? !astraMissionContainsSecrets(astraMissionPublicView(created)) : false, 'clean'))
  cases.push(check('14_12_unconfigured_ais_cannot_seed', buildTerraCouncilHandoffPayload({ object: { ...vessel(), provider: 'aisstream' } }) === null, 'blocked'))
  cases.push(check(
    '14_13_orchestration_only',
    Boolean(created && !created.plan?.selectedPermanentSeats.includes('astra' as never)),
    String(created?.plan?.selectedPermanentSeats),
  ))
  cases.push(check('14_14_no_constellation_spawn', created?.constellation?.spawned === false, String(created?.constellation?.spawned)))
  cases.push(check('14_15_completed_cannot_reenter_running', created ? astraExecuteConflict('completed') === 'already_completed' && markAstraMissionRunning({ ...created, status: 'completed' }).status === 'completed' : false, 'guarded'))
  cases.push(check('14_16_failed_cannot_reenter_running', astraExecuteConflict('failed') === 'already_failed', 'deterministic failed'))
  cases.push(check(
    '14_17_vessel_fields_present_only',
    Boolean(created?.observedVessel?.mmsi === '230685000' && created.observedVessel.imo === '9264727' && created.observedVessel.speedKnots === 12.4 && created.observedVessel.navigationStatus === 'Under way using engine'),
    JSON.stringify(created?.observedVessel),
  ))
  cases.push(check(
    '14_18_commander_objective_preserved',
    created?.objective === "Analyze this vessel's current observed activity using only the supplied Terra intelligence.",
    created?.objective ?? 'missing',
  ))
  cases.push(check(
    '14_19_public_view_terra_lineage',
    Boolean(created && astraMissionPublicView(created).terraEvidenceId === 'digitraffic_marine:230685000' && astraMissionPublicView(created).terraProvider === 'digitraffic_marine'),
    JSON.stringify(created ? astraMissionPublicView(created) : null),
  ))
  cases.push(check(
    '14_20_audit_created_kind',
    created?.audit[0]?.kind === 'MISSION_CREATED',
    created?.audit[0]?.kind ?? 'missing',
  ))

  const tmp = mkdtempSync(path.join(tmpdir(), 'wr-astra-missions-'))
  const previousDir = process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
  const previousForce = process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
  process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = tmp
  process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = '1'
  resetAstraMissionStoreProbe()
  try {
    if (!created) throw new Error('fixture mission missing')
    const stored = await saveAstraLiveMission(created)
    cases.push(check('14_21_durable_create', stored.persistenceBackend === 'local_filesystem_fallback' && stored.status === 'planned', stored.persistenceBackend ?? 'missing'))

    resetAstraMissionStoreProbe()
    const reopened = await getAstraLiveMission(stored.id)
    cases.push(check(
      '14_22_restart_persistence',
      Boolean(reopened && reopened.id === stored.id && reopened.objective === stored.objective && reopened.status === 'planned' && reopened.terraSeed?.lineage.evidenceId === 'digitraffic_marine:230685000'),
      reopened?.id ?? 'missing',
    ))

    const listed = await listAstraLiveMissions('commander-test')
    cases.push(check('14_23_list_durable_missions', listed.some(item => item.id === stored.id), String(listed.length)))

    const unknown = await getAstraLiveMission('astra-mission-does-not-exist')
    cases.push(check('14_24_unknown_mission_not_found', unknown === null, String(unknown)))

    const claimedA = claimAstraMissionRunning({ id: stored.id, commanderUserId: 'commander-test', nowIso: NOW })
    const claimedB = claimAstraMissionRunning({ id: stored.id, commanderUserId: 'commander-test', nowIso: NOW })
    const [first, second] = await Promise.all([claimedA, claimedB])
    const successes = [first, second].filter(result => result.ok)
    const conflicts = [first, second].filter(result => !result.ok && result.code === 'already_running')
    cases.push(check('14_25_atomic_planned_to_running', successes.length === 1 && successes[0]?.ok === true && successes[0].mission.status === 'running', `ok=${successes.length}`))
    cases.push(check('14_26_duplicate_execute_prevented', conflicts.length === 1, `conflicts=${conflicts.length}`))

    const afterClaim = await getAstraLiveMission(stored.id)
    cases.push(check('14_27_running_persisted', afterClaim?.status === 'running' && afterClaim.startedAt !== null, afterClaim?.status ?? 'missing'))

    if (afterClaim) {
      const completed = await saveAstraLiveMission(markAstraMissionCompleted(afterClaim, {
        councilConversationId: '11111111-2222-4333-8444-555555555555',
        outcomeSummary: 'Council execution completed through the existing /api/chat path.',
        nowIso: NOW,
      }))
      cases.push(check('14_28_completed_persists_conversation', completed.status === 'completed' && completed.councilConversationId === '11111111-2222-4333-8444-555555555555', completed.councilConversationId ?? 'missing'))
      const completedClaim = await claimAstraMissionRunning({ id: completed.id, commanderUserId: 'commander-test' })
      cases.push(check('14_29_completed_cannot_execute_again', !completedClaim.ok && completedClaim.code === 'already_completed', completedClaim.ok ? 'executed' : completedClaim.code))
      resetAstraMissionStoreProbe()
      const completedReopen = await getAstraLiveMission(completed.id)
      cases.push(check(
        '14_50_restart_after_completed',
        Boolean(completedReopen && completedReopen.status === 'completed' && completedReopen.objective === stored.objective && completedReopen.councilConversationId === '11111111-2222-4333-8444-555555555555' && completedReopen.terraSeed?.lineage.objectId === '230685000' && completedReopen.completedAt === NOW),
        completedReopen?.status ?? 'missing',
      ))
    }

    const failMission = await saveAstraLiveMission(createAstraLiveMission({
      commanderUserId: 'commander-test',
      objective: 'Controlled failure isolation mission for ASTRA.',
      terraSeed: seed,
      nowIso: NOW,
    })!)
    const failClaim = await claimAstraMissionRunning({ id: failMission.id, commanderUserId: 'commander-test', nowIso: NOW })
    const failedStored = failClaim.ok
      ? await saveAstraLiveMission(markAstraMissionFailed(failClaim.mission, 'Controlled Council execution failure', NOW))
      : null
    cases.push(check('14_30_controlled_failure_failed', failedStored?.status === 'failed' && failedStored.error === 'Controlled Council execution failure' && failedStored.terraSeed?.lineage.objectId === '230685000', failedStored?.status ?? 'missing'))
    const failedClaim = failedStored ? await claimAstraMissionRunning({ id: failedStored.id, commanderUserId: 'commander-test' }) : { ok: true as const, mission: failMission }
    cases.push(check('14_31_failed_stays_failed', !failedClaim.ok && 'code' in failedClaim && failedClaim.code === 'already_failed', 'deterministic'))

    const store = await describeAstraMissionStore()
    cases.push(check('14_32_fallback_is_labeled', store.backend === 'local_filesystem_fallback', store.backend))
  } finally {
    if (previousDir === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
    else process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = previousDir
    if (previousForce === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
    else process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = previousForce
    resetAstraMissionStoreProbe()
    rmSync(tmp, { recursive: true, force: true })
  }

  cases.push(check(
    '14_33_routes_require_commander_session',
    sourceContains('app/api/astra/missions/route.ts', /requireCommanderSession/)
      && sourceContains('app/api/astra/missions/[id]/route.ts', /requireCommanderSession/)
      && sourceContains('app/api/astra/missions/[id]/execute/route.ts', /requireCommanderSession/),
    'session gated',
  ))
  cases.push(check(
    '14_34_execute_uses_existing_council_entry',
    sourceContains('app/api/astra/missions/[id]/execute/route.ts', /executeCouncilChatRequest/),
    'existing council path',
  ))
  cases.push(check(
    '14_35_no_autonomous_commit_push_deploy',
    !sourceContains('lib/astra/liveMission.ts', /git commit|git push|deploy production|autonomous crawl/i)
      && !sourceContains('app/api/astra/missions/[id]/execute/route.ts', /git commit|git push/),
    'no commit authority',
  ))
  cases.push(check(
    '14_36_no_autonomous_source_ingest_or_crawl',
    !sourceContains('lib/astra/liveMission.ts', /crawlApprovedUrl|ingestSource|sovereign-search:crawl/)
      && !sourceContains('app/api/astra/missions/route.ts', /crawlApprovedUrl|ingestSource/),
    'no crawl',
  ))
  cases.push(check(
    '14_37_homepage_has_no_astra_buttons',
    !sourceContains('app/page.tsx', /Create ASTRA mission|Run ASTRA mission/),
    'homepage boundary',
  ))
  cases.push(check(
    '14_38_terra_create_requires_selection',
    sourceContains('components/war-room/terra/TerraShell.tsx', /canCreateAstraMission = canSendSelectedToCouncil/)
      && sourceContains('components/war-room/terra/TerraShell.tsx', /canRunAstraMission = Boolean\(astraMission\?\.id\) && astraMission\?\.status === 'planned'/),
    'selection != create != execute',
  ))
  cases.push(check(
    '14_39_conversation_metadata_lineage',
    sourceContains('lib/astra/liveMission.store.ts', /missionId/)
      && sourceContains('lib/astra/liveMission.store.ts', /terraEvidenceId/)
      && sourceContains('app/api/astra/missions/[id]/execute/route.ts', /createAstraCouncilConversation/),
    'conversation lineage',
  ))
  cases.push(check(
    '14_40_constellation_spawn_deferred',
    sourceContains('lib/council/constellation/planner.ts', /Phase 1B planning only/)
      && sourceContains('lib/council/constellation/types.ts', /Always false until a later live-execution phase/),
    'CONSTELLATION LIVE SPAWN DEFERRED',
  ))
  cases.push(check(
    '14_41_durable_store_not_in_memory_map',
    sourceContains('lib/astra/liveMission.store.ts', /war_room_astra_missions/)
      && sourceContains('lib/astra/liveMission.store.ts', /local_filesystem_fallback/)
      && !sourceContains('lib/astra/liveMission.store.ts', /missions\s*=\s*new Map/),
    'supabase + labeled filesystem fallback',
  ))
  cases.push(check(
    '14_42_object_type_and_mmsi_persisted',
    Boolean(created && astraMissionPublicView(created).terraObjectType === 'vessel_position' && astraMissionPublicView(created).terraMmsi === '230685000'),
    JSON.stringify(created ? { type: astraMissionPublicView(created).terraObjectType, mmsi: astraMissionPublicView(created).terraMmsi } : null),
  ))
  cases.push(check(
    '14_43_origin_retained_terra',
    created ? astraMissionPublicView(created).terraOriginRetained === 'TERRA' : false,
    String(created ? astraMissionPublicView(created).terraOriginRetained : 'missing'),
  ))
  cases.push(check(
    '14_44_13_bridge_module_intact',
    sourceContains('lib/terra/councilHandoff.ts', /Roadmap #13/)
      && sourceContains('lib/terra/councilHandoff.ts', /digitraffic_marine|UNCONFIGURED_AIS_PROVIDERS/),
    '#13 regression source',
  ))
  cases.push(check(
    '14_45_12_live_intel_module_intact',
    sourceContains('lib/terra/liveGeoIntelligence.ts', /TerraLiveGeoObject/)
      && sourceContains('lib/terra/normalizeDigitrafficMarineVessels.ts', /digitraffic_marine/),
    '#12 regression source',
  ))
  cases.push(check(
    '14_46_council_pipeline_entry_intact',
    sourceContains('app/api/chat/execute.ts', /export async function executeCouncilChatRequest/),
    'Council regression source',
  ))
  cases.push(check(
    '14_47_audit_kinds_cover_lifecycle',
    created?.audit.some(event => event.kind === 'MISSION_CREATED') === true
      && sourceContains('lib/astra/liveMission.store.ts', /insertWarRoomAuditLog/),
    'audit infrastructure',
  ))
  cases.push(check(
    '14_48_no_authority_expansion',
    !sourceContains('app/api/astra/missions/[id]/execute/route.ts', /crawlApprovedUrl|ingestSource|git commit|git push/)
      && sourceContains('app/api/astra/missions/route.ts', /requireCommanderSession/)
      && sourceContains('app/api/astra/missions/[id]/execute/route.ts', /requireCommanderSession/),
    'commander gated, no crawl/commit',
  ))

  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runAstraLiveMissionValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`ASTRA live mission: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
