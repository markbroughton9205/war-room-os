/**
 * HVS Cinema Director foundation — kernel + wiring lock.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.cinema-director.foundation.validation.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, emptyProject, HVSPROJ_VERSION } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { fromSeconds, toSeconds } from './time'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { productionAuthorityOk, proveNoMutation } from './production-ai'
import { mayPublishAutomatically, maySpendMoney } from './policy'
import { HVS_CINEMA_DIRECTOR_SLICE, HVS_SECTIONS } from './navigation'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { is3DDirectorPrompt } from './director3d/intent'
import {
  HVS_CINEMA_ANGLES,
  HVS_CINEMA_FRAMING,
  HVS_CINEMA_MOVEMENTS,
  HVS_CINEMA_SHOT_SIZES,
  HVS_CAMERA_PATCH_KINDS,
  HVS_LENS_MM,
  HVS_MOVIE_PRESETS,
  HVS_RELATIVE_PLACEMENTS,
} from './cinema-director/types'
import { describeLensBehavior, isCinemaDirectorPrompt, parseCinemaIntent } from './cinema-director/parse'
import { buildCinemaPlan } from './cinema-director/plan'
import { compileCinemaScene } from './cinema-director/compile'
import { apply3DOps } from './director3d/ops'
import { evaluateScene } from './director3d/evaluate'
import { pathChangesFocalLength, pathChangesPosition } from './cinema-director/path'
import { applyCameraPlanPatch, parseCameraPlanPatch } from './cinema-director/patch'
import { compileCameraSpecForBackend } from './cinema-director/provider'
import { storyboardLinksForPlan, destructionShakeForEvent } from './cinema-director/bridges'
import { attachCinemaPlan, attachCinemaPrevis } from './cinema-director/persist'
import { directCinemaFromPrompt, previewCinemaPlan, applyCinemaRevision } from './cinema-director/contract'
import { MOVIE_CAMERA_PRESETS } from './cinema-director/presets'
import { evaluateContinuity } from './cinema-director/continuity'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const LIVE = 'Create an 11-second cinematic sequence. Start with a 24mm wide establishing shot. Cut to a low-angle shot behind the black car. Orbit clockwise around the driver\'s side while keeping the person on the left third. Then use an 85mm close-up and slowly push toward the person\'s face.'
const D3 = 'Create an 8-second nighttime city shot. Place a person beside a black car. Have the person walk toward a doorway. Start the camera low behind the car. Orbit around the person. Finish with a close-up.'
const FOCUS = 'Start focused on the car and pull focus to the person. Use a 50mm medium shot of the black car and the person.'
const DIALOGUE = 'Two-person dialogue. OTS A then OTS B.'
const CROSS = 'Two-person dialogue. OTS A then OTS B. Cross the axis on purpose.'

expect('slice_id', HVS_CINEMA_DIRECTOR_SLICE === 'HVS-CINEMA-DIRECTOR-FOUNDATION', HVS_CINEMA_DIRECTOR_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('shot_taxonomy', HVS_CINEMA_SHOT_SIZES.includes('EXTREME_WIDE') && HVS_CINEMA_SHOT_SIZES.includes('INSERT') && HVS_CINEMA_SHOT_SIZES.length === 9, HVS_CINEMA_SHOT_SIZES.join(','))
expect('angles', HVS_CINEMA_ANGLES.includes('WORMS_EYE') && HVS_CINEMA_ANGLES.includes('DUTCH'), HVS_CINEMA_ANGLES.join(','))
expect('movement', HVS_CINEMA_MOVEMENTS.includes('DOLLY_IN') && HVS_CINEMA_MOVEMENTS.includes('DOLLY_ZOOM') && HVS_CINEMA_MOVEMENTS.includes('ORBIT') && HVS_CINEMA_MOVEMENTS.includes('HANDHELD'), String(HVS_CINEMA_MOVEMENTS.length))
expect('framing', HVS_CINEMA_FRAMING.includes('LEFT_THIRD') && HVS_CINEMA_FRAMING.includes('CENTER_LOCK'), HVS_CINEMA_FRAMING.join(','))
expect('lenses', HVS_LENS_MM.includes(24) && HVS_LENS_MM.includes(85), HVS_LENS_MM.join(','))
expect('relative', HVS_RELATIVE_PLACEMENTS.includes('BEHIND') && HVS_RELATIVE_PLACEMENTS.includes('FOLLOW_BEHIND'), HVS_RELATIVE_PLACEMENTS.join(','))
expect('presets', HVS_MOVIE_PRESETS.length === 11 && Boolean(MOVIE_CAMERA_PRESETS.HERO_LOW_WIDE), String(HVS_MOVIE_PRESETS.length))
expect('patch_kinds', HVS_CAMERA_PATCH_KINDS.includes('CHANGE_ORBIT') && HVS_CAMERA_PATCH_KINDS.includes('CHANGE_HEIGHT'), HVS_CAMERA_PATCH_KINDS.join(','))
expect('lens_behavior_wide', describeLensBehavior(24).perspective === 'expanded', describeLensBehavior(24).notes[0])
expect('lens_behavior_long', describeLensBehavior(85).perspective === 'compressed', describeLensBehavior(85).notes[0])
expect('section_camera', HVS_SECTIONS.some(item => item.id === 'camera' && item.slice0 === 'live'), 'nav')
expect('page_exists', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/camera/page.tsx')), 'page')
expect('ui_exists', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsCinemaDirectorScreen.tsx')), 'ui')
expect('no_vendor_magic', !source('lib/media-command/cinema-director/types.ts').includes('runway') && !source('lib/media-command/cinema-director/types.ts').includes('kling'), 'neutral')
expect('contract_hvs', source('lib/media-command/hvs-producer-contract.ts').includes('directCinemaFromPrompt') && source('lib/media-command/hvs-producer-contract.ts').includes('previewCinemaPlan'), 'HVS.directCinemaFromPrompt')
expect('advanced_editor_preserved', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx')), 'editor')
expect('version_browser_preserved', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'versions')
expect('render_engine_preserved', source('lib/media-command/render-engine.ts').includes('export async function processRenderQueue'), 'render')
expect('ai_first_preserved', source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('data-testid="hvs-ai-create"'), 'ai first')
expect('war_room_entry', source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('data-testid="hvs-ai-direct-this-scene"'), 'direct this scene')
expect('no_second_timeline', !source('lib/media-command/cinema-director/types.ts').includes('CinemaTimeline'), 'timeline')
expect('storyboard_bridge', source('lib/media-command/cinema-director/bridges.ts').includes('storyboardLinksForPlan'), 'storyboard')
expect('destruction_bridge', destructionShakeForEvent('MAJOR_COLLAPSE').intensity > 0 && source('lib/media-command/cinema-director/types.ts').includes('HvsCinemaDestructionCue'), 'destruction')

expect('is_cinema_prompt', isCinemaDirectorPrompt(LIVE), 'live')
expect('direct_this_scene', isCinemaDirectorPrompt('Direct this scene. Start on a low-angle 24mm wide shot behind the car.'), 'direct')
expect('not_3d_prompt', !isCinemaDirectorPrompt(D3) && is3DDirectorPrompt(D3), '3d preserved')
expect('war_room_kind_cinema', detectHvsProductionIntent(LIVE) === 'cinema', detectHvsProductionIntent(LIVE))
expect('war_room_kind_3d', detectHvsProductionIntent(D3) === 'director3d', detectHvsProductionIntent(D3))

const project = emptyProject({ id: 'hvs-cinema-foundation', name: 'Cinema Director foundation' })
const before = cloneProject(project)
const routed = HVS.directCinemaFromPrompt(project, { prompt: LIVE, projectId: project.id })
expect('intent_created', Boolean(routed.intent.id) && routed.intent.shotIntent.length >= 4, String(routed.intent.shotIntent.length))
expect('intent_subjects', routed.intent.subjectRefs.some(item => item.kind === 'person') && routed.intent.propRefs.some(item => item.kind === 'car'), JSON.stringify(routed.intent.propRefs))
expect('plan_created', routed.plan.approvalAction === 'PREVIEW' && routed.plan.mutated === false && routed.plan.shots.length >= 4, String(routed.plan.shots.length))
expect('approval_required', routed.approvalRequired === true && routed.mutated === false, String(routed.mutated))
expect('no_mutation_before_approval', proveNoMutation(before, project) && JSON.stringify(before.cinemaDirector) === JSON.stringify(project.cinemaDirector) && JSON.stringify(before.director3d) === JSON.stringify(project.director3d), 'mutated')

let blocked = false
try {
  previewCinemaPlan(project, routed.intent, routed.plan)
} catch {
  blocked = true
}
expect('preview_blocked_without_approval', blocked, 'gate')

const shots = routed.plan.shots
expect('shot_24mm', shots.some(item => item.cameraSpec.focalLengthMm === 24 && (item.shotSize === 'WIDE' || item.shotRole === 'ESTABLISHING')), shots.map(s => `${s.name}:${s.cameraSpec.focalLengthMm}`).join('|'))
expect('shot_low_angle', shots.some(item => item.cameraAngle === 'LOW_ANGLE' && item.relativePlacement === 'BEHIND'), shots.map(s => `${s.name}:${s.cameraAngle}:${s.relativePlacement}`).join('|'))
expect('shot_orbit_cw', shots.some(item => item.cameraMovement === 'ORBIT' && item.orbit?.direction === 'CLOCKWISE' && Math.abs((item.orbit.endAngle - item.orbit.startAngle) - Math.PI) < 0.2), JSON.stringify(shots.find(s => s.cameraMovement === 'ORBIT')?.orbit))
expect('shot_left_third', shots.some(item => item.framing === 'LEFT_THIRD'), shots.map(s => s.framing).join('|'))
expect('shot_85mm_push', shots.some(item => item.cameraSpec.focalLengthMm === 85 && item.shotSize === 'CLOSE_UP' && item.cameraMovement === 'DOLLY_IN'), shots.map(s => `${s.name}:${s.cameraSpec.focalLengthMm}:${s.cameraMovement}`).join('|'))
expect('subject_target', shots.every(item => item.targetRef), 'targets')
expect('rational_timing', shots.every(item => item.start.timescale > 0 && item.duration.ticks > 0) && Math.abs(toSeconds(routed.plan.duration) - 11) < 0.6, String(toSeconds(routed.plan.duration)))
expect('commander_list', routed.plan.commanderShotList.length >= 4, routed.plan.commanderShotList.map(s => s.name).join('|'))

const orbitPath = routed.plan.paths.find(item => item.shotId === shots.find(s => s.cameraMovement === 'ORBIT')?.id)
expect('orbit_geometry', Boolean(orbitPath && orbitPath.points.length >= 6 && pathChangesPosition(orbitPath)), String(orbitPath?.points.length))
const pushShot = shots.find(item => item.cameraMovement === 'DOLLY_IN')
const pushPath = routed.plan.paths.find(item => item.shotId === pushShot?.id)
expect('dolly_not_zoom', Boolean(pushPath && pathChangesPosition(pushPath) && !pathChangesFocalLength(pushPath)), `pos=${pushPath ? pathChangesPosition(pushPath) : false} fl=${pushPath ? pathChangesFocalLength(pushPath) : false}`)

const zoomIntent = parseCinemaIntent({ prompt: 'Zoom in on her face with an 85mm close-up. Do not dolly.', projectId: project.id })
const zoomPlan = buildCinemaPlan(zoomIntent)
const zoomPath = zoomPlan.paths[0]
expect('zoom_not_dolly', zoomPath ? !pathChangesPosition(zoomPath) && pathChangesFocalLength(zoomPath) : false, `pos=${zoomPath ? pathChangesPosition(zoomPath) : 'none'} fl=${zoomPath ? pathChangesFocalLength(zoomPath) : 'none'}`)

const dzIntent = parseCinemaIntent({ prompt: 'Dolly zoom toward her on a 50mm medium shot.', projectId: project.id })
const dzPlan = buildCinemaPlan(dzIntent)
const dzPath = dzPlan.paths.find(item => item.shotId === dzPlan.shots.find(s => s.cameraMovement === 'DOLLY_ZOOM')?.id) ?? dzPlan.paths[0]
expect('dolly_zoom_both', Boolean(dzPath && pathChangesPosition(dzPath) && pathChangesFocalLength(dzPath)), `move=${dzPlan.shots[0]?.cameraMovement}`)

const built = previewCinemaPlan(project, routed.intent, routed.plan, { approved: true })
expect('built_scene', Boolean(built.scene.id) && built.scene.shots.length >= 4 && built.scene.cameras.length >= 4, `${built.scene.shots.length} shots / ${built.scene.cameras.length} cams`)
expect('placeholders', built.scene.objects.some(item => item.placeholder === 'person') && built.scene.objects.some(item => item.placeholder === 'car') && built.scene.objects.some(item => item.placeholder === 'building'), built.scene.objects.map(o => o.placeholder).join(','))
expect('project_camera_specs', (built.project.timeline.cameraSpecs?.length ?? 0) >= 4, String(built.project.timeline.cameraSpecs?.length))
expect('cinema_store', built.project.cinemaDirector?.activePlanId === built.plan.id, built.project.cinemaDirector?.activePlanId ?? 'none')

const t0 = evaluateScene(built.scene, fromSeconds(0.2, built.scene.duration.timescale))
const tOrbit = evaluateScene(built.scene, fromSeconds(6.2, built.scene.duration.timescale))
const tEnd = evaluateScene(built.scene, fromSeconds(10.2, built.scene.duration.timescale))
expect('shot_switch', Boolean(t0.activeShotId && tOrbit.activeShotId && tEnd.activeShotId && t0.activeShotId !== tOrbit.activeShotId && tOrbit.activeShotId !== tEnd.activeShotId), `${t0.activeShotId} → ${tOrbit.activeShotId} → ${tEnd.activeShotId}`)
expect('previs_focal_24', t0.focalLength === 24 || Math.abs(t0.focalLength - 24) < 1, String(t0.focalLength))
expect('previs_focal_85', tEnd.focalLength === 85 || Math.abs(tEnd.focalLength - 85) < 1, String(tEnd.focalLength))
const cam0 = t0.activeCameraId ? t0.nodes[built.scene.cameras.find(c => c.id === t0.activeCameraId)?.nodeId ?? ''] : null
const camO = tOrbit.activeCameraId ? t0.nodes[built.scene.cameras.find(c => c.id === tOrbit.activeCameraId)?.nodeId ?? ''] : null
void camO
const orbitEvalA = evaluateScene(built.scene, fromSeconds(5.2, built.scene.duration.timescale))
const orbitEvalB = evaluateScene(built.scene, fromSeconds(7.2, built.scene.duration.timescale))
const orbitCamA = built.scene.cameras.find(c => c.id === orbitEvalA.activeCameraId)
const orbitCamB = built.scene.cameras.find(c => c.id === orbitEvalB.activeCameraId)
const posA = orbitCamA ? orbitEvalA.nodes[orbitCamA.nodeId]?.transform.position : null
const posB = orbitCamB ? orbitEvalB.nodes[orbitCamB.nodeId]?.transform.position : null
expect('orbit_moves', Boolean(posA && posB && Math.hypot(posA.x - posB.x, posA.z - posB.z) > 0.4), JSON.stringify({ posA, posB }))
expect('camera_path_present', built.scene.paths.some(item => item.kind === 'CAMERA' && item.points.length >= 2), String(built.scene.paths.length))

const patch = parseCameraPlanPatch(built.plan, 'Make the orbit slower and lower the camera.')
expect('patch_proposal', patch.status === 'proposed' && patch.kinds.includes('CHANGE_SPEED') && patch.kinds.includes('CHANGE_HEIGHT') && patch.approvalRequired, patch.kinds.join(','))
const orbitBefore = built.plan.shots.find(item => item.cameraMovement === 'ORBIT')
let revBlocked = false
try {
  applyCinemaRevision(built.project, routed.intent, built.plan, patch)
} catch {
  revBlocked = true
}
expect('revision_blocked_without_approval', revBlocked, 'gate')
const revised = applyCinemaRevision(built.project, routed.intent, built.plan, patch, { approved: true })
const orbitAfter = revised.plan.shots.find(item => item.cameraMovement === 'ORBIT')
expect('revision_same_shot', orbitBefore?.id === orbitAfter?.id && revised.plan.shots.length === built.plan.shots.length, `${orbitBefore?.id} → ${orbitAfter?.id}`)
expect('revision_slower', Boolean(orbitAfter && orbitBefore && toSeconds(orbitAfter.duration) > toSeconds(orbitBefore.duration)), `${orbitBefore ? toSeconds(orbitBefore.duration) : 0} → ${orbitAfter ? toSeconds(orbitAfter.duration) : 0}`)
expect('revision_lower', Boolean(orbitAfter && orbitBefore && (orbitAfter.orbit?.height ?? 99) < (orbitBefore.orbit?.height ?? 0)), `${orbitBefore?.orbit?.height} → ${orbitAfter?.orbit?.height}`)
expect('no_full_rebuild_ids', revised.project.id === built.project.id && revised.plan.sceneId === built.plan.sceneId, revised.plan.sceneId)

const focusIntent = parseCinemaIntent({ prompt: FOCUS, projectId: project.id })
const focusPlan = buildCinemaPlan(focusIntent)
expect('focus_transition', focusPlan.focusTransitions.some(item => item.fromTarget.id === 'CAR_1' && item.toTarget.kind === 'PERSON'), JSON.stringify(focusPlan.focusTransitions))

const dialogueIntent = parseCinemaIntent({ prompt: DIALOGUE, projectId: project.id })
const dialoguePlan = buildCinemaPlan(dialogueIntent)
expect('ots_pair', dialoguePlan.shots.length >= 2 && dialoguePlan.shots.every(item => item.shotRole === 'OVER_THE_SHOULDER'), dialoguePlan.shots.map(s => s.name).join('|'))
expect('line_of_action', Boolean(dialoguePlan.continuity.lineOfAction) && dialoguePlan.continuity.screenDirections.length >= 2, JSON.stringify(dialoguePlan.continuity.lineOfAction))
expect('default_ots_no_hard_block', !dialoguePlan.continuity.warnings.some(item => item.rule === 'AXIS_180'), JSON.stringify(dialoguePlan.continuity.warnings))
const crossIntent = parseCinemaIntent({ prompt: CROSS, projectId: project.id })
const crossPlan = buildCinemaPlan(crossIntent)
expect('axis_warning_not_refusal', crossPlan.continuity.warnings.some(item => item.kind === 'CONTINUITY_WARNING' && item.rule === 'AXIS_180' && item.intentionalAxisBreak), JSON.stringify(crossPlan.continuity.warnings))
const jump = evaluateContinuity([
  { ...dialoguePlan.shots[0], cameraAngleDegrees: { pitch: 0, yaw: 0.1, roll: 0 }, cameraMovement: 'STATIC' },
  { ...dialoguePlan.shots[1], cameraAngleDegrees: { pitch: 0, yaw: 0.2, roll: 0 }, cameraMovement: 'STATIC', shotRole: 'MASTER' },
])
expect('thirty_degree_warning', jump.warnings.some(item => item.rule === 'JUMP_CUT_30'), JSON.stringify(jump.warnings))

const compiled = compileCameraSpecForBackend(shots[0].cameraSpec, 'hvs-3d', { shot: shots[0], path: routed.plan.paths[0] })
expect('compiler_geometric', compiled.honesty === 'GEOMETRIC' && compiled.capabilities.includes('FULL_3D_CAMERA'), compiled.honesty)
const promptApprox = compileCameraSpecForBackend(shots[0].cameraSpec, 'prompt', { shot: shots[0] })
expect('compiler_prompt', promptApprox.honesty === 'PROMPT_APPROXIMATION' && promptApprox.capabilities.includes('PROMPT_ONLY'), promptApprox.honesty)
expect('no_paid_generation', !maySpendMoney() && !mayPublishAutomatically() && productionAuthorityOk().ok, 'policy')

const persistable = attachCinemaPrevis(emptyProject({ id: 'hvs-cinema-persist', name: 'persist' }), built.plan, built.scene)
const roundTrip = parseHvsProject(serializeHvsProject(persistable))
expect('persistence', roundTrip.cinemaDirector?.plans[0]?.id === built.plan.id && (roundTrip.timeline.cameraSpecs?.length ?? 0) >= 4, String(roundTrip.cinemaDirector?.plans[0]?.id))
expect('versions_existing', Array.isArray(roundTrip.versions) && !JSON.stringify(roundTrip.cinemaDirector).includes('"revisions"'), String(roundTrip.versions.length))
expect('storyboard_links', storyboardLinksForPlan(built.plan, []).every(item => item.shotId) && built.plan.storyboardLinks.length === built.plan.shots.length, String(built.plan.storyboardLinks.length))
expect('3d_bridge', built.scene.cameras.every(item => item.cameraSpecId), built.scene.cameras.map(c => c.cameraSpecId).join(','))
expect('handheld_layer', Boolean(buildCinemaPlan(parseCinemaIntent({ prompt: 'Slow handheld medium shot of the person.', projectId: project.id })).shots[0]?.handheld), 'handheld')
expect('crane', buildCinemaPlan(parseCinemaIntent({ prompt: 'Start overhead and crane down toward the car.', projectId: project.id })).shots.some(item => item.cameraMovement === 'CRANE'), 'crane')
expect('apply_patch_fn', applyCameraPlanPatch(built.plan, patch).shots.length === built.plan.shots.length, 'patch apply')
expect('compile_ops', compileCinemaScene(routed.intent, routed.plan).ops.some(op => op.kind === 'ADD_CAMERA'), 'ops')
expect('apply_ops', apply3DOps(compileCinemaScene(routed.intent, { ...routed.plan, status: 'approved' }).scene, compileCinemaScene(routed.intent, { ...routed.plan, status: 'approved' }).ops).cameras.length >= 4, 'apply')
expect('attach_plan', attachCinemaPlan(project, routed.plan).cinemaDirector?.plans.length === 1, 'attach')
expect('api_route', source('app/api/media-command/cinema/route.ts').includes("action === 'preview'") && source('app/api/media-command/cinema/route.ts').includes('approvalRequired'), 'api')
expect('war_room_cinema', source('app/api/media-command/war-room/route.ts').includes('cinema') && source('lib/media-command/war-room-hvs.ts').includes('packetFromCinemaPlan'), 'war room')
expect('shot_list_ui', source('components/war-room/higher-vision-studios/HvsCinemaDirectorScreen.tsx').includes('YOUR SHOTS') || source('components/war-room/higher-vision-studios/HvsCinemaDirectorScreen.tsx').includes('Your shots'), 'ui list')
expect('pkg_wired', source('package.json').includes('hvs.cinema-director.foundation.validation.ts'), 'wired')
expect('g10_untouched', HVS_MATRIX_ROWS.find(row => row.id === 'G10-01')?.state === 'SHIPPED', 'virtual follow')
expect('g22_02_shell', HVS_MATRIX_ROWS.find(row => row.id === 'G22-02')?.state === 'SHELL', String(HVS_MATRIX_ROWS.find(row => row.id === 'G22-02')?.state))
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', true, 'MATRIX_EXTENSION_REQUIRED')
expect('cam0', Boolean(cam0), 'eval')

const failed = results.filter(item => !item.pass)
for (const item of results) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
}
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed: failed.length, total: results.length, names: failed.map(item => item.name) }, null, 2))
  process.exit(1)
}
console.log(JSON.stringify({
  ok: true,
  total: results.length,
  matrix: 'MATRIX_EXTENSION_REQUIRED',
  generation: 'NOT AUTHORIZED',
}))
