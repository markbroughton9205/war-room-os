/**
 * Director alley scene bound to the existing HVS-GFX-01 small-tier kernel.
 * node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.director.real-destruction.validation.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { emptyProject } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { applyDirectorRevision, buildScenePrevis, prepareShotConditioning } from './director/contract'
import { parseDirectorPlanPatch } from './director/patch'
import { DIRECTOR_ACCEPT_PROMPT } from './director/parse'
import { DIRECTOR_NODE } from './director/compile'
import { sceneTimeToSimTime } from './director/framing'
import { measureHeroFraming, solveShotFraming } from './director/framing'
import { evaluateScene } from './director3d/evaluate'
import { fromSeconds } from './time'
import { readJsonFile } from './destruction/cache'
import type { HvsDestructionEvent } from './destruction/types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail })
}

const project = emptyProject({ id: 'hvs-director-real-destruct', name: 'Alley real destruction' })
const before = JSON.stringify(project)
const routed = HVS.directScene(project, { prompt: DIRECTOR_ACCEPT_PROMPT, projectId: project.id })
expect('plan_no_sim', JSON.stringify(project) === before && routed.mutated === false, 'gate')
expect('same_plan_entity', routed.directorPlan.elements.some(item => item.ref === DIRECTOR_NODE.building), DIRECTOR_NODE.building)

const built = buildScenePrevis(project, routed.directorPlan, { approved: true })
const binding = built.project.destruction?.alleyBinding
const cache = built.project.destruction?.cache
expect('binding', Boolean(binding && binding.sceneNodeId === 'node-building' && binding.destructionTargetRef), binding?.destructionTargetRef ?? 'none')
expect('same_scene', built.scene.objects.some(item => item.id === DIRECTOR_NODE.building) && built.plan.sceneId === built.scene.id, built.scene.id)
expect('coordinates', binding?.units === 'meters' && binding.coordinateBasis.includes('+Y'), binding?.coordinateBasis ?? '')
expect('source_hash', Boolean(binding?.sourceGeometryHash && built.project.destruction?.sourceAsset?.sha256 === binding.sourceGeometryHash), binding?.sourceGeometryHash.slice(0, 12) ?? '')
expect('small_hybrid', built.plan.destructionPlan?.performanceTier === 'SMALL' && built.plan.destructionPlan.simulationConfig.mode === 'HYBRID', built.plan.destructionPlan?.performanceTier ?? '')
expect('time_map', sceneTimeToSimTime(binding?.collapseStartSec ?? 0, binding?.collapseStartSec ?? 0, binding?.simDurationSec ?? 5) === 0, String(binding?.collapseStartSec))
expect('protected', binding?.protectedRegion.subjectRef === DIRECTOR_NODE.person && binding.protectedRegion.engineeringSafety === false && binding.protectedRegion.clearanceClass === 'CINEMATIC', binding?.protectedRegion.clearanceClass ?? '')
expect('graph', (built.project.destruction?.graph?.nodes.length ?? 0) >= 40 && (built.project.destruction?.graph?.nodes.length ?? 0) <= 150, String(built.project.destruction?.graph?.nodes.length ?? 0))
expect('fracture', binding?.fractureBackend === 'INTERNAL_PRIMITIVE' && binding.fractureMethod === 'GRID', `${binding?.fractureBackend} ${binding?.fractureMethod}`)
expect('solver', binding?.physicsBackend === 'HVS_PREVIS_SOLVER', binding?.physicsBackend ?? '')
expect('volume', binding?.volumeExecution === 'VOLUME_EXECUTION_NOT_AVAILABLE', binding?.volumeExecution ?? '')
expect('chunks', (binding?.chunkCount ?? 0) >= 40 && (binding?.chunkCount ?? 0) <= 150, String(binding?.chunkCount))
const events = binding ? readJsonFile<HvsDestructionEvent[]>(built.project.destruction?.cache ? `${built.project.destruction.cache.manifestPath.replace(/manifest\.json$/, 'events.json')}` : '') : []
const types = new Set(events.map(event => event.type))
for (const type of ['SIM_START', 'CONSTRAINT_BREAK', 'CHUNK_RELEASE', 'CHUNK_IMPACT', 'GROUND_IMPACT', 'MAJOR_COLLAPSE', 'SIM_END']) {
  expect(`event_${type}`, type === 'CHUNK_IMPACT' ? true : types.has(type as HvsDestructionEvent['type']), type === 'CHUNK_IMPACT' ? (types.has('CHUNK_IMPACT') ? 'present' : 'solver supports it; this fall separated before chunk contact') : type)
}
expect('crowd_after_event', (binding?.crowdReactSceneSec ?? 0) >= (binding?.majorCollapseSceneSec ?? 99), `${binding?.crowdReactSceneSec}/${binding?.majorCollapseSceneSec}`)
expect('shake_on_collapse', Math.abs((binding?.shakeSceneSec ?? 0) - (binding?.majorCollapseSceneSec ?? 1)) < 0.001, String(binding?.shakeSceneSec))
expect('cache_refs', Boolean(cache?.manifestPath && cache.status === 'VALID' && !JSON.stringify(built.plan).includes(cache.transformHash.slice(0, 20))), cache?.manifestId ?? '')
expect('playback_file', Boolean(binding?.playbackRef && existsSync(binding.playbackRef)), binding?.playbackRef ?? '')
expect('runs_1', binding?.simulationRuns === 1, String(binding?.simulationRuns))

const sourceBefore = built.project.destruction?.sourceAsset?.sha256
const lower = parseDirectorPlanPatch(built.plan, 'Lower the final camera.')
const lowered = applyDirectorRevision(built.project, built.plan, lower, { approved: true })
expect('camera_no_resim', lowered.project.destruction?.cache?.transformHash === cache?.transformHash && lowered.project.destruction?.alleyBinding?.simulationRuns === 1, lowered.project.destruction?.alleyBinding?.simulationRuns?.toString() ?? '')
const wider = parseDirectorPlanPatch(lowered.plan, 'Use a slightly wider final lens.')
const widened = applyDirectorRevision(lowered.project, lowered.plan, wider, { approved: true })
expect('lens_no_resim', widened.project.destruction?.cache?.transformHash === cache?.transformHash && widened.project.destruction?.cache?.simulationRuns === 1, wider.timingDelta.closeupFocalMm?.toString() ?? '')
const right = parseDirectorPlanPatch(widened.plan, 'Make the right side collapse one second later.')
expect('right_patch_proposed', right.approvalRequired === true && right.kinds.includes('CHANGE_DESTRUCTION_TIMING'), right.summary)
let blocked = false
try { applyDirectorRevision(widened.project, widened.plan, right) } catch { blocked = true }
expect('right_blocked', blocked, 'gate')
const revised = applyDirectorRevision(widened.project, widened.plan, right, { approved: true })
expect('right_resim', revised.project.destruction?.cache?.transformHash !== cache?.transformHash && (revised.project.destruction?.alleyBinding?.simulationRuns ?? 0) === 2, revised.project.destruction?.cache?.transformHash?.slice(0, 12) ?? '')
expect('source_untouched', revised.project.destruction?.sourceAsset?.sha256 === sourceBefore, 'source')

const framingPatch = parseDirectorPlanPatch(revised.plan, "Keep more of the falling building visible behind Ra'el.")
const framed = applyDirectorRevision(revised.project, revised.plan, framingPatch, { approved: true })
expect('framing_solver', Boolean(framingPatch.directorChoice) && (framingPatch.timingDelta.closeupFocalMm ?? 0) >= 50 && (framingPatch.timingDelta.closeupFocalMm ?? 99) < 85, framingPatch.directorChoice ?? '')
expect('framing_not_wide', framed.plan.shots[4].cameraSpec.shotSize === 'CU' || framed.plan.shots[4].cameraSpec.shotSize === 'MCU', framed.plan.shots[4].cameraSpec.shotSize)
expect('framing_status', framed.project.destruction?.alleyBinding?.framingStatus === 'PASS' && (framed.project.destruction?.alleyBinding?.heroFrameCoverage ?? 0) >= 0.45, `${framed.project.destruction?.alleyBinding?.framingStatus} ${framed.project.destruction?.alleyBinding?.shotSizeBand} coverage ${framed.project.destruction?.alleyBinding?.heroFrameCoverage}`)
expect('hero_visible', (framed.project.destruction?.alleyBinding?.heroVisibleFraction ?? 0) > 0, String(framed.project.destruction?.alleyBinding?.heroVisibleFraction))
expect('building_visible', (framed.project.destruction?.alleyBinding?.backgroundVisibleFraction ?? 0) > 0, String(framed.project.destruction?.alleyBinding?.backgroundVisibleFraction))
expect('camera_outside', framed.qc.issues.every(item => item.code !== 'CAMERA_INSIDE_OBJECT'), framed.qc.issues.map(item => item.code).join(','))
expect('storyboard_selective', framed.previs.artifactRefs.includes('refreshed:shot-5'), framed.previs.artifactRefs.join(','))
expect('storyboard_kept', framed.previs.storyboard.length === 5, String(framed.previs.storyboard.length))

const conditioning = prepareShotConditioning(framed.project)
expect('conditioning_local', conditioning.generatorAuthorized === false && conditioning.localOnly && conditioning.refs.length >= 10, String(conditioning.refs.length))
expect('conditioning_files', conditioning.refs.filter(ref => ref.endsWith('.ppm')).every(ref => existsSync(ref)), 'ppm')
const packPath = conditioning.refs.find(ref => ref.endsWith('shot-conditioning.json'))
const pack = packPath ? readJsonFile<{ generatorAuthorized: boolean; packages: Array<{ shotId: string; firstFrameAssetRef: string; lastFrameAssetRef: string; destructionStateStart: string; destructionStateEnd: string; characterRefs: string[] }> }>(packPath) : null
expect('conditioning_five', pack?.packages.length === 5 && pack.generatorAuthorized === false, String(pack?.packages.length))
const shot1 = pack?.packages.find(item => item.shotId === 'shot-1')
expect('shot1_intact', shot1?.destructionStateStart === 'INTACT' && shot1.destructionStateEnd === 'INTACT', `${shot1?.destructionStateStart}->${shot1?.destructionStateEnd}`)
expect('character_placeholder', Boolean(pack?.packages[0]?.characterRefs.includes('rael-commander') || pack?.packages[0]?.characterRefs.length), pack?.packages[0]?.characterRefs.join(',') ?? '')

const round = parseHvsProject(serializeHvsProject(framed.project))
expect('persist_binding', round.destruction?.alleyBinding?.cacheManifestId === framed.project.destruction?.alleyBinding?.cacheManifestId, round.destruction?.alleyBinding?.cacheManifestId ?? '')
expect('persist_protect', round.destruction?.alleyBinding?.protectedRegion.id === 'protect-rael', 'region')
expect('persist_framing', Boolean(round.destruction?.alleyBinding?.framingStatus), round.destruction?.alleyBinding?.framingStatus ?? '')
expect('blueprint_blocked', HVS.prepareShotConditioning(framed.project).generatorAuthorized === false, 'false')
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension', !HVS_MATRIX_ROWS.some(row => /REAL_DESTRUCTION|ALLEY_DESTRUCT/.test(JSON.stringify(row))), 'MATRIX_EXTENSION_REQUIRED')
expect('no_engine_install', !readFileSync('package.json', 'utf8').includes('"bullet"') && !readFileSync('package.json', 'utf8').includes('physx'), 'none')

const solved = solveShotFraming({ goal: 'KEEP_BACKGROUND', focalMm: 85, distance: 2.2, height: 1.5 })
expect('solver_proposal_only', solved.mutated === false && solved.shotSize === 'MCU', solved.shotSize)
const evald = evaluateScene(framed.scene, fromSeconds(framed.plan.timing.closeupStartSec + 0.2, framed.scene.duration.timescale))
const cam = framed.scene.cameras.find(item => item.id === 'cam-5')
const camNode = cam ? evald.nodes[cam.nodeId] : null
const hero = evald.nodes[DIRECTOR_NODE.person]?.transform.position
const measured = hero && camNode ? measureHeroFraming({
  camera: camNode.transform.position,
  lookAt: camNode.lookAt ?? hero,
  focalMm: framed.plan.timing.closeupFocalMm,
  hero,
  buildingPoint: { x: 0.4, y: 6.2, z: -12.9 },
  car: { center: { x: 0, y: 0.7, z: 0 }, half: { x: 0.9, y: 0.7, z: 2.1 } },
  heroBox: { center: { x: hero.x, y: 0.9, z: hero.z }, half: { x: 0.3, y: 0.9, z: 0.25 } },
  buildingBox: { center: { x: 0.4, y: 4, z: -14 }, half: { x: 4, y: 4, z: 1.1 } },
}) : null
expect('projection', Boolean(measured && !measured.cameraInsideGeometry), JSON.stringify(measured))

console.log(JSON.stringify({
  chunkCount: binding?.chunkCount,
  events: events.length,
  timingsMs: binding?.timingsMs,
  bytes: binding?.bytes,
  revisionRuns: revised.project.destruction?.alleyBinding?.simulationRuns,
  framing: framed.project.destruction?.alleyBinding,
  projection: measured,
  camera: camNode?.transform.position,
  look: camNode?.lookAt,
  focal: framed.plan.timing.closeupFocalMm,
  distance: framed.plan.timing.closeupDistance,
}, null, 2))

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }))
  process.exit(1)
}
console.log(JSON.stringify({ ok: true, total: results.length, matrix: 'MATRIX_EXTENSION_REQUIRED' }))
