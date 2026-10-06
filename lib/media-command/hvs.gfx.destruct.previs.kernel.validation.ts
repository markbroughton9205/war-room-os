/**
 * HVS-GFX-01 destruction previs kernel.
 * Physical wall collapse, revision, and cache reuse. Not a static schema-only check.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { emptyProject, cloneProject } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { saveProject, loadProject } from './store'
import { listJobs } from './jobs'
import { sha256Buffer, sha256Json } from './destruction/hash'
import { fractureInternalPrimitive } from './destruction/fracture'
import { parseDestructionIntent, validateDestructionIntent } from './destruction/intent'
import { buildDestructionPlan, planHash, validateDestructionPlan } from './destruction/plan'
import { applyApprovedDestructionPatch, proposeDestructionPatch } from './destruction/patch'
import { HVS_MATERIAL_IDS } from './destruction/materials'
import { audioCueClass } from './destruction/cues'
import {
  HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID,
  HVS_DESTRUCTION_ACCEPTANCE_PROMPT,
  HVS_DESTRUCTION_REVISION_PROMPT,
  PROPRIETARY_REFERENCE_LOCK,
  REALTIME_PREVIS_FPS_THRESHOLD,
} from './destruction/types'
import {
  cacheStillValid,
  ensureImmutableWallSource,
  invalidateDestructionCache,
  replayDestructionCamera,
  setDestructionLook,
  simulateDestruction,
} from './destruction/execute'
import { readJsonFile } from './destruction/cache'
import { countBright, rasterPlaybackFrame } from './destruction/raster'
import { auditDestructionBackends, BACKEND_INSTALL_APPROVAL_REQUIRED } from './destruction/backends'
import { auditNebulaHardware } from './destruction/hardware'
import { DESTRUCTION_LICENSE_MANIFEST, licenseManifestAllowsIntegration } from './destruction/license'
import { mediaCommandDataHierarchy } from './paths'
import type { HvsDestructionEvent } from './destruction/types'
import type { HvsDestructionPlayback } from './destruction/playback'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function meanY(playback: HvsDestructionPlayback, kind: 'LEFT_SUPPORT' | 'RIGHT_SUPPORT', frame: number, highOnly: boolean): number {
  const nodes = playback.nodes.filter(node => node.supportClass === kind && node.role === 'PRIMARY_CHUNKS' && (!highOnly || node.frames[0].y > 1.4))
  const total = nodes.reduce((sum, node) => sum + node.frames[Math.min(frame, node.frames.length - 1)].y, 0)
  return nodes.length ? total / nodes.length : 0
}

async function main() {
  const project = emptyProject({ id: HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID, name: 'HVS DESTRUCTION TEST — WALL 01' })
  const beforePlan = JSON.stringify(project)
  const planned = HVS.planDestruction(project, {
    prompt: HVS_DESTRUCTION_ACCEPTANCE_PROMPT,
    projectId: project.id,
    sceneId: 'scene-wall-01',
  })
  expect('intent_created', Boolean(planned.intent.id) && planned.intent.destructionClass === 'WALL', planned.intent.destructionClass)
  expect('plan_created', Boolean(planned.plan.id) && planned.plan.status === 'DRAFT', planned.plan.summary)
  expect('approval_required', planned.approvalRequired === true && planned.mutated === false, String(planned.mutated))
  expect('no_simulation_before_approval', JSON.stringify(project) === beforePlan && project.destruction?.cache == null, 'project unchanged')
  expect('intent_schema', validateDestructionIntent(planned.intent).ok, validateDestructionIntent(planned.intent).errors.join(','))
  expect('plan_schema', validateDestructionPlan(planned.plan).ok, validateDestructionPlan(planned.plan).errors.join(','))
  expect('material_concrete', planned.plan.materialAssignments[0]?.materialId === 'CONCRETE', planned.plan.materialAssignments[0]?.materialId ?? '')
  expect('hybrid_default', planned.intent.mode === 'HYBRID', planned.intent.mode)
  expect('left_first_guide', planned.plan.guidePlan.primitives.some(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'LEFT'), 'guide')
  expect('right_protected', planned.plan.guidePlan.primitives.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT'), 'protect')
  expect('prefracture_only', planned.plan.fracturePlan.preFractureOnly === true && planned.plan.fracturePlan.runtimeFracture === false, 'prefracture')
  expect('cinematic_force_only', planned.plan.forcePlan.cinematicForceOnly === true, 'force')
  expect('commander_steps', planned.plan.commanderSteps.some(step => /left/i.test(step)) && planned.plan.commanderSteps.some(step => /debris/i.test(step)), planned.plan.commanderSteps.join(' | '))

  let blocked = false
  try {
    await simulateDestruction(project, { plan: planned.plan, intent: planned.intent, approval: false })
  } catch {
    blocked = true
  }
  expect('simulate_blocked_without_approval', blocked, 'gate')
  expect('project_still_unmutated', JSON.stringify(project) === beforePlan, 'gate')

  const severe = parseDestructionIntent({ prompt: 'Collapse a city block', projectId: project.id })
  const severePlan = buildDestructionPlan(severe)
  expect('large_schema_only', validateDestructionPlan(severePlan).ok && severePlan.operationalSupport === false, severe.performanceTier)
  let largeBlocked = false
  try {
    await simulateDestruction(project, { plan: severePlan, intent: severe, approval: true })
  } catch (error) {
    largeBlocked = error instanceof Error && error.message.includes('not authorized')
  }
  expect('large_not_authorized', largeBlocked, 'tier')

  const prompts: Array<[string, (plan: ReturnType<typeof buildDestructionPlan>) => boolean]> = [
    ['Collapse the front wall.', plan => plan.fracturePlan.materialId === 'CONCRETE'],
    ['Make the left side fall first.', plan => plan.guidePlan.primitives.some(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'LEFT')],
    ['Break the windows first.', plan => plan.guidePlan.primitives.some(guide => guide.kind === 'BREAK_FIRST' && guide.region === 'WINDOWS')],
    ['Keep the right column standing.', plan => plan.guidePlan.primitives.some(guide => guide.kind === 'PROTECT_REGION' && guide.region === 'RIGHT')],
    ['Add more debris.', plan => plan.debrisPlan.secondaryBudget >= 18],
    ['Make the collapse slower.', plan => plan.simulationConfig.durationSec >= 7],
    ['Make it hit the ground harder.', plan => plan.forcePlan.impulseClass === 'STRONG'],
  ]
  for (const [prompt, check] of prompts) {
    const intent = parseDestructionIntent({ prompt, projectId: project.id })
    const plan = buildDestructionPlan(intent)
    expect(`prompt_${prompt.slice(0, 24).replace(/\s+/g, '_')}`, check(plan), prompt)
  }

  const first = await simulateDestruction(project, { plan: planned.plan, intent: planned.intent, approval: true })
  expect('simulate_ok', first.ok, first.error ?? 'ok')
  expect('input_project_not_mutated', JSON.stringify(project) === beforePlan, 'immutability of caller')
  const destruction = first.project.destruction
  if (!first.ok || !destruction?.cache || !destruction.previsTicket?.playbackRef || !destruction.graph || !destruction.plan) {
    throw new Error(first.error ?? 'simulation failed')
  }
  const store = { ...destruction, cache: destruction.cache, graph: destruction.graph, previsTicket: destruction.previsTicket }
  const playback = readJsonFile<HvsDestructionPlayback>(store.previsTicket!.playbackRef!)
  const events = readJsonFile<HvsDestructionEvent[]>(path.join(path.dirname(store.cache.manifestPath), 'events.json'))
  const releases = events.filter(event => event.type === 'CHUNK_RELEASE')
  const firstRelease = releases[0]
  expect('chunks_in_budget', first.chunkCount >= 40 && first.chunkCount <= 150, String(first.chunkCount))
  expect('structural_graph', store.graph.nodes.length === first.chunkCount && store.graph.edges.length > 0 && store.graph.anchors.length > 0, `${store.graph.nodes.length} nodes`)
  expect('supports', store.graph.nodes.some(node => node.supportClass === 'LEFT_SUPPORT') && store.graph.nodes.some(node => node.supportClass === 'RIGHT_SUPPORT'), 'supports')
  expect('left_releases_first', Boolean(firstRelease && firstRelease.nodeId?.startsWith('chunk-c0')), firstRelease?.nodeId ?? 'none')
  expect('right_not_released', !releases.some(event => event.nodeId?.includes('chunk-c8') || event.nodeId?.includes('chunk-c9')), 'right held')
  const leftStart = meanY(playback, 'LEFT_SUPPORT', 0, true)
  const leftEnd = meanY(playback, 'LEFT_SUPPORT', playback.frameCount - 1, true)
  const rightStart = meanY(playback, 'RIGHT_SUPPORT', 0, true)
  const rightEnd = meanY(playback, 'RIGHT_SUPPORT', playback.frameCount - 1, true)
  expect('left_chunks_fall', leftEnd < leftStart - 0.7, `${leftStart.toFixed(2)} -> ${leftEnd.toFixed(2)}`)
  expect('right_support_stays', Math.abs(rightEnd - rightStart) < 0.08, `${rightStart.toFixed(2)} -> ${rightEnd.toFixed(2)}`)
  expect('ground_impact', events.some(event => event.type === 'GROUND_IMPACT'), String(events.filter(event => event.type === 'GROUND_IMPACT').length))
  expect('primary_debris', playback.nodes.some(node => node.role === 'PRIMARY_CHUNKS'), 'primary')
  expect('secondary_debris', first.secondaryDebris > 0, String(first.secondaryDebris))
  expect('events_recorded', events.some(event => event.type === 'SIM_START') && events.some(event => event.type === 'SIM_END') && events.some(event => event.type === 'CONSTRAINT_BREAK') && events.some(event => event.type === 'MAJOR_COLLAPSE'), String(events.length))
  expect('cache_written', store.cache.status === 'VALID' && store.cache.simulationRuns === 1, store.cache.manifestId)
  expect('cache_not_in_project_bytes', !serializeHvsProject(first.project).includes('"frames"'), 'refs only')
  expect('source_untouched', sha256Buffer(readFileSync(store.sourceAsset!.path)) === first.sourceSha256, first.sourceSha256.slice(0, 12))
  expect('fracture_backend', first.fractureBackend === 'INTERNAL_PRIMITIVE', first.fractureBackend)
  expect('physics_backend', first.physicsBackend === 'HVS_PREVIS_SOLVER', first.physicsBackend)
  expect('volume_not_faked', first.volumeExecution === 'VOLUME_EXECUTION_NOT_AVAILABLE' && store.cache !== null, first.volumeExecution)
  expect('audio_cue_contract', audioCueClass('CONCRETE', 'CHUNK_IMPACT') === 'concrete_impact' && audioCueClass('GLASS', 'CONSTRAINT_BREAK') === 'glass_break' && audioCueClass('METAL', 'MAJOR_COLLAPSE') === 'metal_groan', 'cues')
  expect('previs_playable', Boolean(store.previsTicket.artifactRef) && playback.summary.includes('Front wall collapse'), store.previsTicket.artifactRef ?? '')
  const startPx = rasterPlaybackFrame(playback, 0, 320, 180)
  const endPx = rasterPlaybackFrame(playback, playback.frameCount - 1, 320, 180)
  const startLeftUpper = countBright(startPx, 320, 180, 'far-left-upper')
  const endLeftUpper = countBright(endPx, 320, 180, 'far-left-upper')
  const startRightUpper = countBright(startPx, 320, 180, 'far-right-upper')
  const endRightUpper = countBright(endPx, 320, 180, 'far-right-upper')
  const endLeftLower = countBright(endPx, 320, 180, 'left-lower')
  expect('previs_start_intact', startLeftUpper > 40 && startRightUpper > 40, `L${startLeftUpper} R${startRightUpper}`)
  expect('previs_left_falls_visually', endLeftUpper < startLeftUpper * 0.55, `start ${startLeftUpper} end ${endLeftUpper}`)
  expect('previs_right_standing_visually', endRightUpper > startRightUpper * 0.55, `start ${startRightUpper} end ${endRightUpper}`)
  expect('previs_wreck_on_ground', endLeftLower > 20, String(endLeftLower))
  expect('settled', Math.abs(meanY(playback, 'LEFT_SUPPORT', playback.frameCount - 1, true) - meanY(playback, 'LEFT_SUPPORT', playback.frameCount - 4, true)) < 0.2, 'settle')
  expect('realtime_threshold_defined', REALTIME_PREVIS_FPS_THRESHOLD === 24, String(first.rasterFps.toFixed(1)))
  expect('realtime_previs_measured', first.realtimePrevis === 'PASS' || first.realtimePrevis === 'FAIL', `${first.realtimePrevis} ${first.rasterFps.toFixed(1)} fps`)

  const replay = await replayDestructionCamera(first.project, 'three-quarter')
  expect('camera_replay_no_resim', replay.resimulated === false && replay.simulationRuns === 1 && replay.transformHash === first.transformHash, replay.transformHash.slice(0, 12))
  const replayFrame = rasterPlaybackFrame(replay.playback, Math.floor(replay.playback.frameCount * 0.45), 320, 180)
  const sameCamera = rasterPlaybackFrame(playback, Math.floor(playback.frameCount * 0.45), 320, 180)
  expect('new_camera_changes_pixels', !replayFrame.equals(sameCamera), 'camera')

  const looked = setDestructionLook(replay.project, '#667788', 'concrete_impact')
  looked.notes = 'caption and look metadata only'
  expect('look_does_not_invalidate', cacheStillValid(looked.destruction!, looked.destruction!.plan!, looked.destruction!.graph!, looked.destruction!.sourceAsset!.sha256), looked.destruction?.cache?.status ?? '')
  expect('look_keeps_transform', looked.destruction?.cache?.transformHash === first.transformHash && looked.destruction?.cache?.simulationRuns === 1, 'reuse')

  const saved = await saveProject(looked)
  const loaded = await loadProject(saved.id)
  expect('persistence_plan', loaded?.destruction?.plan?.id === looked.destruction?.plan?.id, loaded?.destruction?.plan?.id ?? '')
  expect('persistence_graph', loaded?.destruction?.graph?.id === looked.destruction?.graph?.id, loaded?.destruction?.graph?.id ?? '')
  expect('persistence_material', loaded?.destruction?.plan?.materialAssignments[0]?.materialId === 'CONCRETE', 'material')
  expect('persistence_cache', loaded?.destruction?.cache?.manifestId === looked.destruction?.cache?.manifestId && loaded?.destruction?.cache?.status === 'VALID', loaded?.destruction?.cache?.status ?? '')
  const round = parseHvsProject(serializeHvsProject(saved))
  expect('hvsproj_roundtrip', round.destruction?.plan?.id === saved.destruction?.plan?.id && round.formatVersion === 0, String(round.formatVersion))
  expect('timeline_untouched', JSON.stringify(saved.timeline) === JSON.stringify(cloneProject(project).timeline), 'timeline')
  expect('effect_color_audio_untouched', saved.effectGraphs.length === project.effectGraphs.length && saved.colorPipeline.nodes.length === project.colorPipeline.nodes.length && saved.audioGraph.channels.length === project.audioGraph.channels.length, 'lanes')

  const patch = proposeDestructionPatch(planned.plan, HVS_DESTRUCTION_REVISION_PROMPT)
  expect('patch_proposal', patch.kind === 'BREAK_REGION_FIRST' && patch.approvalRequired === true && patch.mutated === false, patch.kind)
  let patchBlocked = false
  try {
    applyApprovedDestructionPatch(planned.plan, patch, false)
  } catch {
    patchBlocked = true
  }
  expect('patch_requires_approval', patchBlocked, 'gate')
  const revisedPlan = applyApprovedDestructionPatch(planned.plan, patch, true)
  expect('patch_applied', revisedPlan.version === 2 && revisedPlan.guidePlan.primitives.some(guide => guide.kind === 'RELEASE_AT' && guide.region === 'RIGHT'), String(revisedPlan.version))
  expect('patch_changes_hash', planHash(revisedPlan) !== planHash(planned.plan), 'hash')
  const invalidated = invalidateDestructionCache(looked, 'revision')
  expect('cache_invalidated', invalidated.destruction?.cache?.status === 'INVALID', invalidated.destruction?.cache?.status ?? '')
  const second = await simulateDestruction(invalidated, { plan: revisedPlan, intent: planned.intent, approval: true })
  expect('revision_simulated', second.ok, second.error ?? 'ok')
  if (!second.ok || !second.project.destruction?.previsTicket?.playbackRef) throw new Error(second.error ?? 'revision failed')
  const revisedPlayback = readJsonFile<HvsDestructionPlayback>(second.project.destruction.previsTicket.playbackRef)
  const mid = Math.round(1 * revisedPlayback.fps)
  const rightMid = meanY(revisedPlayback, 'RIGHT_SUPPORT', mid, true)
  const rightLate = meanY(revisedPlayback, 'RIGHT_SUPPORT', revisedPlayback.frameCount - 1, true)
  expect('right_still_up_at_one_second', Math.abs(rightMid - rightStart) < 0.15, rightMid.toFixed(2))
  expect('right_falls_after_delay', rightLate < rightStart - 0.7, `${rightStart.toFixed(2)} -> ${rightLate.toFixed(2)}`)
  expect('revision_new_cache', second.transformHash !== first.transformHash, second.transformHash.slice(0, 12))
  expect('source_still_untouched', sha256Buffer(readFileSync(store.sourceAsset!.path)) === first.sourceSha256, 'source')

  const failProject = emptyProject({ id: 'hvs-gfx01-fail-iso', name: 'fail isolation' })
  const failJson = JSON.stringify(failProject)
  const source = ensureImmutableWallSource('hvs-gfx01-fail-iso-wall-source')
  const failed = await simulateDestruction(failProject, {
    plan: planned.plan,
    intent: planned.intent,
    approval: true,
    fracture: () => { throw new Error('fracture failed closed') },
  })
  expect('failure_isolated', failed.ok === false && JSON.stringify(failProject) === failJson && sha256Buffer(readFileSync(source.path)) === source.sha256, failed.error ?? '')
  const jobs = listJobs(HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID)
  expect('jobs_completed', jobs.some(job => job.status === 'COMPLETED' && job.provenance.capability === 'DESTRUCTION_SIM'), jobs.map(job => `${job.provenance.capability}:${job.status}`).join(','))
  expect('jobs_use_existing_kind', jobs.every(job => job.kind === 'vfx'), 'vfx')

  const voronoiA = fractureInternalPrimitive({ spec: { ...planned.plan.fracturePlan, method: 'VORONOI' }, sourcePath: source.path, holdRightSupport: true })
  const voronoiB = fractureInternalPrimitive({ spec: { ...planned.plan.fracturePlan, method: 'VORONOI' }, sourcePath: source.path, holdRightSupport: true })
  expect('deterministic_fracture', sha256Json(voronoiA.pieces) === sha256Json(voronoiB.pieces), 'seed')
  expect('materials', HVS_MATERIAL_IDS.length === 8 && HVS_MATERIAL_IDS.includes('GLASS') && HVS_MATERIAL_IDS.includes('METAL'), HVS_MATERIAL_IDS.join(','))
  expect('reference_lock', PROPRIETARY_REFERENCE_LOCK.frostbite === 'REFERENCE_ONLY' && PROPRIETARY_REFERENCE_LOCK.unrealChaos === 'REFERENCE_ONLY', 'lock')
  expect('license_manifest', licenseManifestAllowsIntegration() && DESTRUCTION_LICENSE_MANIFEST.every(entry => String(entry.license) !== 'UNKNOWN'), String(DESTRUCTION_LICENSE_MANIFEST.length))
  expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
  expect('matrix_extension_required', !HVS_MATRIX_ROWS.some(row => /HVS-GFX-01|DESTRUCT_PREVIS/.test(`${row.id} ${JSON.stringify(row)}`)), 'MATRIX_EXTENSION_REQUIRED')
  expect('no_new_dependency', !readFileSync('package.json', 'utf8').includes('bullet-physics') && !readFileSync('package.json', 'utf8').includes('"jolt"'), 'none')

  const hardware = auditNebulaHardware(mediaCommandDataHierarchy().cache)
  const backends = auditDestructionBackends()
  console.log(JSON.stringify({
    hardware,
    backends,
    installApproval: BACKEND_INSTALL_APPROVAL_REQUIRED,
    bytes: first.bytes,
    timingsMs: first.timingsMs,
    rasterFps: first.rasterFps,
    realtimePrevis: first.realtimePrevis,
    revisionBytes: second.bytes,
    revisionTimingsMs: second.timingsMs,
    chunkCount: first.chunkCount,
    eventCount: first.eventCount,
    secondaryDebris: first.secondaryDebris,
    previsBackend: first.previsBackend,
    fractureBackend: first.fractureBackend,
    physicsBackend: first.physicsBackend,
    volumeExecution: first.volumeExecution,
  }, null, 2))

  const failedChecks = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  if (failedChecks.length) {
    console.error(JSON.stringify({ ok: false, failed: failedChecks.length, total: results.length }, null, 2))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, total: results.length, matrix: 'MATRIX_EXTENSION_REQUIRED' }))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
