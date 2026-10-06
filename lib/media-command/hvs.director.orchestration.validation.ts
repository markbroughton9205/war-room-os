/**
 * HVS Director Orchestration — kernel + wiring lock.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.director.orchestration.validation.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, emptyProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { proveNoMutation } from './production-ai'
import { HVS_DIRECTOR_ORCHESTRATION_SLICE } from './navigation'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { apply3DOps } from './director3d/ops'
import { evaluateScene } from './director3d/evaluate'
import { fromSeconds } from './time'
import { DIRECTOR_ACCEPT_PROMPT, isDirectorFollowUp, isDirectorOrchestrationPrompt } from './director/parse'
import { buildDirectorPlan, scenePlanFromDirector } from './director/plan'
import { compileDirectorPlan, DIRECTOR_NODE } from './director/compile'
import { parseDirectorPlanPatch } from './director/patch'
import { runDirectorQc } from './director/qc'
import { compileDirectorPlanToPrevis } from './director/previs'
import { requestDirectorVideoGeneration } from './director/blueprint'
import { buildScenePrevis, applyDirectorRevision, useDirectorScene } from './director/contract'
import { destructionStateAt } from './director/clock'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const ACCEPT = DIRECTOR_ACCEPT_PROMPT
const CINEMA = 'Create an 11-second cinematic sequence. Start with a 24mm wide establishing shot. Cut to a low-angle shot behind the black car. Orbit clockwise around the driver\'s side while keeping the person on the left third. Then use an 85mm close-up and slowly push toward the person\'s face.'
const D3 = 'Create an 8-second nighttime city shot. Place a person beside a black car. Have the person walk toward a doorway. Start the camera low behind the car. Orbit around the person. Finish with a close-up.'

expect('slice_id', HVS_DIRECTOR_ORCHESTRATION_SLICE === 'HVS-DIRECTOR-ORCHESTRATION', HVS_DIRECTOR_ORCHESTRATION_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('no_director2', !/\bDirector2\b/.test(source('lib/media-command/director/types.ts')) && !/\bScene2\b/.test(source('lib/media-command/director/compile.ts')), 'no copies')
expect('uses_existing_3d', source('lib/media-command/director/compile.ts').includes("from '../director3d/ops'"), '3d bind')
expect('uses_destruction_kernel', source('lib/media-command/director/plan.ts').includes("from '../destruction/plan'"), 'destruction bind')
expect('uses_cameraspec', source('lib/media-command/director/types.ts').includes('CameraSpec'), 'cinema camera')
expect('shared_clock', source('lib/media-command/director/clock.ts').includes('HVS_SCENE_TIMESCALE'), 'clock')
expect('contract_hvs', source('lib/media-command/hvs-producer-contract.ts').includes('directScene') && source('lib/media-command/hvs-producer-contract.ts').includes('buildScenePrevis'), 'HVS.directScene')
expect('ui_review', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('hvs-director-plan') && source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('Play scene'), 'review ui')
expect('advanced_editor_preserved', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx')), 'editor')
expect('version_browser_preserved', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'versions')
expect('no_paid_api', !source('lib/media-command/director/contract.ts').includes('sk-') && !source('lib/media-command/director/compile.ts').includes('openai'), 'no paid')

expect('is_orchestration_prompt', isDirectorOrchestrationPrompt(ACCEPT), 'accept')
expect('not_cinema_live', !isDirectorOrchestrationPrompt(CINEMA), 'cinema preserved')
expect('not_3d_live', !isDirectorOrchestrationPrompt(D3), '3d preserved')
expect('war_room_kind', detectHvsProductionIntent(ACCEPT) === 'director3d', detectHvsProductionIntent(ACCEPT))
expect('war_room_kind_cinema', detectHvsProductionIntent(CINEMA) === 'cinema', detectHvsProductionIntent(CINEMA))
expect('war_room_kind_3d', detectHvsProductionIntent(D3) === 'director3d', detectHvsProductionIntent(D3))
expect('follow_up', isDirectorFollowUp('Make the orbit slower and have the person reach the doorway before the building starts collapsing.'), 'rev1')

const project = emptyProject({ id: 'hvs-director-orch', name: 'Director orchestration' })
const before = cloneProject(project)
const routed = HVS.directScene(project, { prompt: ACCEPT, projectId: project.id })
expect('plan_created', Boolean(routed.directorPlan.id) && routed.directorPlan.approvalAction === 'BUILD_PREVIS' && routed.mutated === false, routed.directorPlan.status)
expect('approval_required', routed.approvalRequired === true, 'gate')
expect('no_mutation_before_approval', proveNoMutation(before, project) && JSON.stringify(before.director3d) === JSON.stringify(project.director3d), 'mutated')
expect('story_beats', routed.directorPlan.storyBeats.length >= 5, String(routed.directorPlan.storyBeats.length))
expect('shot_count', routed.directorPlan.shots.length >= 5, String(routed.directorPlan.shots.length))
expect('shot_purpose', routed.directorPlan.shots[0].purpose === 'ESTABLISH_GEOGRAPHY' && routed.directorPlan.shots[3].purpose === 'SHOW_IMPACT', routed.directorPlan.shots.map(s => s.purpose).join('|'))
expect('shot_reason', routed.directorPlan.shots.every(shot => shot.directorReason.length > 20), 'reasons')
expect('lens_24', routed.directorPlan.shots[0].cameraSpec.focalLengthMm === 24, String(routed.directorPlan.shots[0].cameraSpec.focalLengthMm))
expect('lens_28', routed.directorPlan.shots[1].cameraSpec.focalLengthMm === 28, String(routed.directorPlan.shots[1].cameraSpec.focalLengthMm))
expect('lens_35_orbit', routed.directorPlan.shots[2].cameraSpec.focalLengthMm === 35 && routed.directorPlan.shots[2].motionPreset === 'ORBIT', routed.directorPlan.shots[2].motionPreset)
expect('lens_85', routed.directorPlan.shots[4].cameraSpec.focalLengthMm === 85, String(routed.directorPlan.shots[4].cameraSpec.focalLengthMm))
expect('collapse_6', Math.abs(routed.directorPlan.timing.collapseSec - 6) < 0.05, String(routed.directorPlan.timing.collapseSec))
expect('spatial', routed.directorPlan.spatialRelations.some(item => item.relation === 'BESIDE') && routed.directorPlan.spatialRelations.some(item => item.relation === 'BEHIND'), String(routed.directorPlan.spatialRelations.length))
expect('lighting', /NIGHT/.test(routed.directorPlan.lightingPlan.summary), routed.directorPlan.lightingPlan.summary)
expect('focus', routed.directorPlan.focusPlan.shots[4].target === 'node-person', routed.directorPlan.focusPlan.shots[4].target)
expect('character_placeholder', routed.directorPlan.characters[0].state === 'PLACEHOLDER CHARACTER', routed.directorPlan.characters[0].label)
expect('rael_identity', routed.directorPlan.characters[0].identityRef === 'rael-commander' && routed.directorPlan.castRefs[0] === 'rael-commander', routed.directorPlan.characters[0].identityRef)
expect('crowd_12', routed.directorPlan.backgroundPopulation.count === 12, String(routed.directorPlan.backgroundPopulation.count))
expect('crowd_after_event', routed.directorPlan.timing.crowdReactSec > routed.directorPlan.timing.collapseSec, `${routed.directorPlan.timing.crowdReactSec}>${routed.directorPlan.timing.collapseSec}`)
expect('shot_purposes_full', ['ESTABLISH_GEOGRAPHY', 'INTRODUCE_SUBJECT', 'TRACK_ACTION', 'SHOW_IMPACT', 'RESOLUTION'].every(p => routed.directorPlan.shots.some(s => s.purpose === p)), routed.directorPlan.shots.map(s => s.purpose).join('|'))
expect('constraints', routed.directorPlan.constraints.includes('KEEP_RAEL_VISIBLE') && routed.directorPlan.constraints.includes('PROTECT_HERO_REGION'), routed.directorPlan.constraints.join('|'))
expect('destruction_hybrid', routed.directorPlan.destructionIntent?.mode === 'HYBRID', String(routed.directorPlan.destructionIntent?.mode))
expect('focus_honesty', routed.directorPlan.focusPlan.honesty === 'METADATA_PASS_VISUAL_PARTIAL', routed.directorPlan.focusPlan.visualDof)
expect('destruction_draft', routed.directorPlan.destructionPlan?.status === 'DRAFT' && routed.directorPlan.destructionHonesty === 'GEOMETRIC_PROXY_NOT_SIMULATION', routed.directorPlan.destructionPlan?.status ?? 'none')
expect('protected_region', routed.directorPlan.protectedSubjectRegion.subjectRef === 'node-person', String(routed.directorPlan.protectedSubjectRegion.radiusMeters))
expect('vfx', routed.directorPlan.vfxCues.some(item => item.kind === 'DUST') && routed.directorPlan.vfxCues.some(item => item.kind === 'CAMERA_SHAKE'), String(routed.directorPlan.vfxCues.length))
expect('continuity_intact', routed.directorPlan.continuityState.destructionStateByTime[0].state === 'INTACT', routed.directorPlan.continuityState.destructionStateByTime[0].state)
expect('transitions_cut', routed.directorPlan.shots.every(shot => shot.transitionIn === 'CUT'), 'cut')
expect('one_car', routed.directorPlan.elements.filter(item => item.kind === 'car').length === 1, 'car')

let blocked = false
try {
  buildScenePrevis(project, routed.directorPlan)
} catch {
  blocked = true
}
expect('build_blocked_without_approval', blocked, 'gate')

const built = buildScenePrevis(project, routed.directorPlan, { approved: true })
expect('scene_built', Boolean(built.scene.id) && built.scene.shots.length >= 5, String(built.scene.shots.length))
expect('stable_ids', Boolean(built.scene.objects.find(item => item.id === DIRECTOR_NODE.person)) && Boolean(built.scene.objects.find(item => item.id === DIRECTOR_NODE.car)) && Boolean(built.scene.objects.find(item => item.id === DIRECTOR_NODE.building)) && Boolean(built.scene.objects.find(item => item.id === DIRECTOR_NODE.doorway)), 'nodes')
expect('subject_path', built.scene.paths.some(item => item.kind === 'SUBJECT' && item.assignedNodeId === DIRECTOR_NODE.person), 'walk')
expect('camera_paths', built.scene.paths.filter(item => item.kind === 'CAMERA').length >= 2, String(built.scene.paths.filter(item => item.kind === 'CAMERA').length))
expect('target_lock', built.scene.cameras.every(cam => cam.target?.kind === 'CHARACTER'), 'lock')
expect('storyboard_frames', built.project.storyboard.length >= 5 && built.previs.storyboard.every(frame => frame.derivedFrom === '3D_CAMERA_EVAL'), String(built.project.storyboard.length))
expect('qc_ok', built.qc.ok, built.qc.issues.map(item => item.code).join(','))
expect('revision_saved', (built.project.director3d?.revisions.length ?? 0) >= 1, String(built.project.director3d?.revisions.length))
expect('rael_bound', Boolean(built.project.characters.some(item => item.id === 'rael-commander') && built.project.digitalHumans?.characters.some(item => item.id === 'rael-commander')), String(built.project.characters.map(c => c.id)))
expect('extras_12', built.scene.props.filter(item => item.kind === 'extra').length === 12, String(built.scene.props.filter(item => item.kind === 'extra').length))
expect('one_playhead', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('playing={false}') && source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('hvs-director-clock'), 'clock')
expect('crowd_tracks', built.previs.crowdTracks.length === 12 && built.previs.actorTracks.length === 1, String(built.previs.crowdTracks.length))

const t0 = evaluateScene(built.scene, fromSeconds(0.2, built.scene.duration.timescale))
const tEst = evaluateScene(built.scene, fromSeconds(1, built.scene.duration.timescale))
const tLow = evaluateScene(built.scene, fromSeconds(3, built.scene.duration.timescale))
const tOrbit = evaluateScene(built.scene, fromSeconds(5, built.scene.duration.timescale))
const tCollapse = evaluateScene(built.scene, fromSeconds(7.5, built.scene.duration.timescale))
const tCu = evaluateScene(built.scene, fromSeconds(10, built.scene.duration.timescale))
expect('shot1_establish', tEst.activeShotId === 'shot-1' && Math.abs(tEst.focalLength - 24) < 1, `${tEst.activeShotId}:${tEst.focalLength}`)
expect('shot2_low', tLow.activeShotId === 'shot-2' && Math.abs(tLow.focalLength - 28) < 1, `${tLow.activeShotId}:${tLow.focalLength}`)
expect('shot3_orbit', tOrbit.activeShotId === 'shot-3' && Math.abs(tOrbit.focalLength - 35) < 1, `${tOrbit.activeShotId}:${tOrbit.focalLength}`)
expect('shot4_retreat', tCollapse.activeShotId === 'shot-4', tCollapse.activeShotId ?? 'none')
expect('shot5_cu', tCu.activeShotId === 'shot-5' && Math.abs(tCu.focalLength - 85) < 1, `${tCu.activeShotId}:${tCu.focalLength}`)
const person0 = t0.nodes[DIRECTOR_NODE.person]?.transform.position
const car0 = t0.nodes[DIRECTOR_NODE.car]?.transform.position
expect('person_beside_car', Boolean(person0 && car0 && Math.abs(person0.x - car0.x) > 1 && Math.abs(person0.z - car0.z) < 1), JSON.stringify({ person0, car0 }))
const personWalk = tOrbit.nodes[DIRECTOR_NODE.person]?.transform.position
expect('subject_motion', Boolean(personWalk && person0 && personWalk.z < person0.z - 1), JSON.stringify(personWalk))
const building0 = t0.nodes[DIRECTOR_NODE.building]?.transform.rotation.x ?? 0
const buildingC = tCollapse.nodes[DIRECTOR_NODE.building]?.transform.rotation.x ?? 0
expect('destruction_state_continuity', building0 === 0 && buildingC > 0.05 && destructionStateAt(6, 7.3, 11, 1) === 'INTACT', `${building0}->${buildingC}`)
const camOrbit = built.scene.cameras.find(item => item.id === 'cam-3')
const orbitNode = tOrbit.nodes[camOrbit?.nodeId ?? '']
expect('orbit_target_lock', Boolean(orbitNode?.lookAt && personWalk && Math.abs(orbitNode.lookAt.x - personWalk.x) < 1.2), JSON.stringify(orbitNode?.lookAt))
expect('clock_timescale', built.scene.timeline.timescale === 24000 && built.previs.duration.timescale === 24000, String(built.scene.timeline.timescale))

const used = useDirectorScene(built.project, built.plan, built.previs)
expect('blueprint', used.blueprint.providerNeutral === true && used.generatorAuthorized === false && used.blueprint.cameraSpecs.length >= 1, String(used.blueprint.cameraSpecs.length))
expect('blueprint_timing', used.blueprint.destructionTiming?.startSec === 6, String(used.blueprint.destructionTiming?.startSec))

const patch1 = parseDirectorPlanPatch(built.plan, 'Make the orbit slower and have Ra\'el reach the doorway before the collapse starts.')
expect('patch1_kinds', patch1.kinds.includes('CHANGE_DESTRUCTION_TIMING') && patch1.kinds.includes('CHANGE_SUBJECT_PATH') && patch1.linkedUpdates.includes('camera.retreat'), patch1.kinds.join(','))
expect('patch1_linked', patch1.timingDelta.walkArriveSec != null && (patch1.timingDelta.collapseSec ?? 0) > (patch1.timingDelta.walkArriveSec ?? 0), JSON.stringify(patch1.timingDelta))
let patchBlocked = false
try {
  applyDirectorRevision(built.project, built.plan, patch1)
} catch {
  patchBlocked = true
}
expect('patch_blocked', patchBlocked, 'gate')
const rev1 = applyDirectorRevision(built.project, built.plan, patch1, { approved: true })
expect('rev1_same_plan', rev1.plan.id === built.plan.id, rev1.plan.id)
expect('rev1_collapse_later', rev1.plan.timing.collapseSec > built.plan.timing.collapseSec, String(rev1.plan.timing.collapseSec))
expect('rev1_arrive_before', rev1.plan.timing.walkArriveSec <= rev1.plan.timing.collapseSec, `${rev1.plan.timing.walkArriveSec}<${rev1.plan.timing.collapseSec}`)
expect('rev1_cues_sync', Math.abs(rev1.plan.timing.retreatSec - (rev1.plan.timing.collapseSec + 0.1)) < 0.05 && Math.abs(rev1.plan.timing.dustSec - (rev1.plan.timing.collapseSec + 1.4)) < 0.05 && Math.abs(rev1.plan.timing.crowdReactSec - (rev1.plan.timing.collapseSec + 0.2)) < 0.05, `${rev1.plan.timing.retreatSec}/${rev1.plan.timing.dustSec}/${rev1.plan.timing.crowdReactSec}`)
expect('rev1_same_person', rev1.scene.objects.filter(item => item.id === DIRECTOR_NODE.person).length === 1, 'person')
expect('rev1_same_car', rev1.scene.props.filter(item => item.kind === 'car').length === 1, 'car')

const patch2 = parseDirectorPlanPatch(rev1.plan, 'Make the final close-up lower and tighter.')
expect('patch2_choice', Boolean(patch2.directorChoice) && (patch2.timingDelta.closeupHeight ?? 99) < rev1.plan.timing.closeupHeight, String(patch2.timingDelta.closeupHeight))
const rev2 = applyDirectorRevision(rev1.project, rev1.plan, patch2, { approved: true })
expect('rev2_same_shot', rev2.plan.shots[4].id === 'shot-5' && rev2.plan.shots[4].targetLock === 'PERSON', rev2.plan.shots[4].id)
expect('rev2_lower', rev2.plan.timing.closeupHeight < rev1.plan.timing.closeupHeight, String(rev2.plan.timing.closeupHeight))

const patch3 = parseDirectorPlanPatch(rev2.plan, 'Keep more of the falling building visible behind Ra\'el.')
expect('patch3_balance', Boolean(patch3.directorChoice) && (patch3.timingDelta.closeupFocalMm ?? 200) < 85, String(patch3.timingDelta.closeupFocalMm))
const rev3 = applyDirectorRevision(rev2.project, rev2.plan, patch3, { approved: true })
expect('rev3_still_cu', rev3.plan.shots[4].purpose === 'RESOLUTION' && (rev3.plan.timing.closeupFocalMm ?? 0) >= 50, String(rev3.plan.timing.closeupFocalMm))
expect('rev3_not_wide', (rev3.plan.shots[4].cameraSpec.shotSize === 'CU' || rev3.plan.shots[4].cameraSpec.shotSize === 'MCU'), rev3.plan.shots[4].cameraSpec.shotSize)

const persist = JSON.parse(JSON.stringify(rev3.project)) as typeof rev3.project
expect('persist_scene', Boolean(persist.director3d?.scenes?.[0]?.objects?.some(item => item.id === 'node-person')), 'reload graph')
expect('persist_storyboard', persist.storyboard.length >= 5, String(persist.storyboard.length))
expect('persist_director_plan', persist.directorOrchestration?.plans?.[0]?.id === rev3.plan.id && persist.directorOrchestration.plans[0].storyBeats.length >= 5, persist.directorOrchestration?.activePlanId ?? 'none')
expect('persist_rael', persist.characters.some(item => item.id === 'rael-commander'), persist.characters.map(c => c.id).join(','))
expect('safety_version', persist.versions.some(item => item.label.includes('Director orchestration safety')), persist.versions.map(v => v.label).join('|'))
expect('no_version_spam', persist.versions.filter(item => item.label.includes('Director orchestration safety')).length === 1, String(persist.versions.length))

const patchLook = parseDirectorPlanPatch(rev3.plan, 'Have Ra\'el look back at the collapse before turning to camera.')
expect('lookback_kind', patchLook.kinds.includes('CHANGE_ACTING') && patchLook.timingDelta.lookBack === true, patchLook.kinds.join(','))
const revLook = applyDirectorRevision(rev3.project, rev3.plan, patchLook, { approved: true })
expect('lookback_same_id', revLook.plan.characters[0].identityRef === 'rael-commander' && revLook.plan.acting.lookBack === true, String(revLook.plan.acting.lookBack))
expect('lookback_no_second_rael', revLook.scene.characters.filter(item => item.identityRef === 'rael-commander' || item.id === 'rael-commander').length === 1, String(revLook.scene.characters.length))
expect('scene_plan_bridge', scenePlanFromDirector(rev3.plan).shotCount >= 5, String(scenePlanFromDirector(rev3.plan).shotCount))
expect('previs_compile', compileDirectorPlanToPrevis(rev3.plan, rev3.scene).playback === 'realtime-viewport', 'previs')
expect('qc_fn', runDirectorQc(rev3.plan, rev3.scene).issues.every(item => item.severity !== 'error'), runDirectorQc(rev3.plan, rev3.scene).issues.map(i => i.code).join(','))

let genBlocked = false
try {
  requestDirectorVideoGeneration()
} catch {
  genBlocked = true
}
expect('generation_blocked', genBlocked, 'NOT AUTHORIZED')
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', true, 'MATRIX_EXTENSION_REQUIRED')
expect('compiled_ops', compileDirectorPlan(buildDirectorPlan({ prompt: ACCEPT, projectId: project.id })).ops.some(op => op.kind === 'CREATE_PATH'), 'ops')
expect('apply_ops', apply3DOps(compileDirectorPlan(routed.directorPlan).scene, compileDirectorPlan(routed.directorPlan).ops).cameras.length === 5, '5 cameras')
expect('api_route', source('app/api/media-command/director3d/route.ts').includes('directScene') && source('app/api/media-command/director3d/route.ts').includes('buildScenePrevis'), 'api')
expect('war_room_director', source('app/api/media-command/war-room/route.ts').includes('packetFromDirectorPlan') && source('lib/media-command/war-room-hvs.ts').includes('packetFromDirectorPlan'), 'war room')
expect('pkg_wired', source('package.json').includes('hvs.director.orchestration.validation.ts'), 'wired')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true,
  total: results.length,
  matrix: 'MATRIX_EXTENSION_REQUIRED',
  generation: 'NOT AUTHORIZED',
}))
