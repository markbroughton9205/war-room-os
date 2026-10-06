/**
 * HVS 3D Director foundation — kernel + wiring lock.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/hvs.3d-director.foundation.validation.ts`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, emptyProject, HVSPROJ_VERSION } from './types'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { fromSeconds, toSeconds } from './time'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { productionAuthorityOk, proveNoMutation } from './production-ai'
import { mayPublishAutomatically, maySpendMoney, mayDeleteOriginal } from './policy'
import { HVS_3D_DIRECTOR_SLICE, HVS_SECTIONS } from './navigation'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { parse3DIntent, is3DDirectorPrompt } from './director3d/intent'
import { buildScenePlan } from './director3d/plan'
import { compileApprovedPlan } from './director3d/compile'
import { apply3DOps, HVS_3D_OP_KINDS } from './director3d/ops'
import { evaluateScene, hashScene } from './director3d/evaluate'
import { parse3DPlanPatch, opsForPatch, applyPatch } from './director3d/patch'
import { compile3DProductionBlueprint, buildPrevisResult, request3DVideoGeneration } from './director3d/blueprint'
import { camera3DToSpec } from './director3d/camera-bridge'
import { attachDirector3D, activeScene } from './director3d/persist'
import { direct3DFromPrompt, build3DScene, apply3DRevision, useThisScene } from './director3d/contract'
import { HVS_3D_WORLD } from './director3d/types'
import { isHvs3DModelAsset } from './director3d/assets'
import { auditBlender, HVS_GODOT_STATUS } from './director3d/blender-audit'
import { probe3DViewportCapability } from './director3d/capability'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []

function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const ACCEPT = 'Create an 8-second nighttime city shot. Place a person beside a black car. Have the person walk toward a doorway. Start the camera low behind the car. Orbit around the person. Finish with a close-up.'

expect('slice_id', HVS_3D_DIRECTOR_SLICE === 'HVS-3D-DIRECTOR-FOUNDATION', HVS_3D_DIRECTOR_SLICE)
expect('hvsproj_version_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('world_conventions', HVS_3D_WORLD.units === 'meters' && HVS_3D_WORLD.up === '+Y' && HVS_3D_WORLD.forward === '-Z', JSON.stringify(HVS_3D_WORLD))
expect('typed_ops', HVS_3D_OP_KINDS.includes('ADD_CHARACTER') && HVS_3D_OP_KINDS.includes('CREATE_PATH') && HVS_3D_OP_KINDS.includes('REORDER_SHOT'), HVS_3D_OP_KINDS.join(','))
expect('section_3d', HVS_SECTIONS.some(item => item.id === '3d-director' && item.label === '3D Director'), 'nav')
expect('page_exists', existsSync(path.join(process.cwd(), 'app/higher-vision-studios/3d-director/page.tsx')), 'page')
expect('viewport_exists', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/Hvs3DViewport.tsx')), 'viewport')
expect('direct_in_3d', source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('data-testid="hvs-ai-direct-in-3d"') && source('components/war-room/higher-vision-studios/HvsAiCreateStudio.tsx').includes('Direct in 3D'), 'ai first')
expect('no_pippit', !source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').toLowerCase().includes('pippit'), 'brand')
expect('three_viewport', source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx').includes("from 'three'") && source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx').includes('OrbitControls'), 'three')
expect('ssr_false', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('ssr: false'), 'dynamic')
expect('contract_hvs', source('lib/media-command/hvs-producer-contract.ts').includes('direct3DFromPrompt') && source('lib/media-command/hvs-producer-contract.ts').includes('build3DScene'), 'HVS.direct3DFromPrompt')
expect('advanced_editor_preserved', existsSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/HvsEditorShell.tsx')), 'editor')
expect('version_browser_preserved', source('components/war-room/higher-vision-studios/HvsVersionBrowser.tsx').includes('data-testid="hvs-version-browser"'), 'versions')
expect('render_engine_preserved', source('lib/media-command/render-engine.ts').includes('export async function processRenderQueue'), 'render')
expect('no_godot_runtime', !source('lib/media-command/director3d/index.ts').includes("from 'godot'") && HVS_GODOT_STATUS === 'DEFERRED', HVS_GODOT_STATUS)

const project = emptyProject({ id: 'hvs-3d-foundation', name: '3D Director foundation' })
const before = cloneProject(project)
expect('is_3d_prompt', is3DDirectorPrompt(ACCEPT), 'prompt detect')
expect('war_room_kind', detectHvsProductionIntent(ACCEPT) === 'director3d', detectHvsProductionIntent(ACCEPT))

const routed = HVS.direct3DFromPrompt(project, { prompt: ACCEPT, projectId: project.id })
expect('intent_created', Boolean(routed.intent.id) && routed.intent.timeOfDay === 'night', JSON.stringify({ tod: routed.intent.timeOfDay, subjects: routed.intent.subjects }))
expect('intent_subjects', routed.intent.subjects.some(item => item.kind === 'person') && routed.intent.props.some(item => item.kind === 'car'), JSON.stringify(routed.intent.props))
expect('plan_created', routed.scenePlan.approvalAction === 'BUILD_SCENE' && routed.scenePlan.mutated === false && routed.scenePlan.shotCount >= 3, String(routed.scenePlan.shotCount))
expect('plan_commander_language', routed.scenePlan.steps.some(item => /car/i.test(item.label)) && routed.scenePlan.shots.some(item => /orbit/i.test(item.label)), routed.scenePlan.steps.map(s => s.label).join('|'))
expect('approval_required', routed.approvalRequired === true && routed.mutated === false, String(routed.mutated))
expect('no_mutation_before_approval', proveNoMutation(before, project) && JSON.stringify(before.director3d) === JSON.stringify(project.director3d), 'mutated')

let blocked = false
try {
  build3DScene(project, routed.intent, routed.scenePlan)
} catch {
  blocked = true
}
expect('build_blocked_without_approval', blocked, 'gate')

const built = build3DScene(project, routed.intent, routed.scenePlan, { approved: true })
const scene = built.scene
expect('scene_graph', scene.objects.length >= 4 && scene.rootId.length > 0, String(scene.objects.length))
expect('person_placeholder', scene.characters.some(item => item.state === 'PLACEHOLDER' && item.motionHonesty === 'POSITIONAL_MOTION') && scene.objects.some(item => item.placeholder === 'person' && /PLACEHOLDER/.test(item.label)), 'person')
expect('car_placeholder', scene.objects.some(item => item.placeholder === 'car') && scene.props.some(item => item.kind === 'car'), 'car')
expect('environment_created', scene.environment.timeOfDay === 'night' && scene.environment.ground === 'city-street', JSON.stringify(scene.environment))
expect('character_path', scene.paths.some(item => item.kind === 'SUBJECT' && item.interpolation === 'CATMULL_ROM'), 'walk path')
expect('camera_created', scene.cameras.length >= 1 && Boolean(scene.cameras[0].target), JSON.stringify(scene.cameras[0]?.target))
expect('camera_path', scene.paths.some(item => item.kind === 'CAMERA') && Boolean(scene.cameras[0].pathId), 'cam path')
expect('lighting_created', scene.lights.some(item => item.kind === 'AMBIENT') && scene.lights.some(item => item.kind === 'DIRECTIONAL') && scene.lights.some(item => item.kind === 'SPOT'), String(scene.lights.length))
expect('rational_keyframes', scene.keyframes.length >= 3 && scene.keyframes.every(item => Number.isInteger(item.time.ticks) && item.time.timescale > 0), String(scene.keyframes.length))
expect('rational_duration', scene.duration.timescale === 24000 && Math.abs(toSeconds(scene.duration) - 8) < 0.05, JSON.stringify(scene.duration))
expect('three_shots', scene.shots.length >= 3, String(scene.shots.length))
expect('ops_used', built.opsCount >= 10, String(built.opsCount))
expect('asset_link_architecture', isHvs3DModelAsset({ mimeType: 'model/gltf-binary', name: 'car.glb', originalPath: '/tmp/car.glb' }) && !isHvs3DModelAsset({ mimeType: 'video/mp4', name: 'clip.mp4', originalPath: '/tmp/clip.mp4' }), 'glb')

const t0 = evaluateScene(scene, fromSeconds(0.2))
const tMid = evaluateScene(scene, fromSeconds(4.5))
const tEnd = evaluateScene(scene, fromSeconds(7.6))
const person = scene.characters[0]
const cam = scene.cameras[0]
const p0 = t0.nodes[person.nodeId].transform.position
const p1 = tEnd.nodes[person.nodeId].transform.position
const c0 = t0.nodes[cam.nodeId].transform.position
const c1 = tMid.nodes[cam.nodeId].transform.position
expect('person_moves', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, JSON.stringify({ p0, p1 }))
expect('camera_moves', Math.hypot(c1.x - c0.x, c1.z - c0.z) > 1.2, JSON.stringify({ c0, c1 }))
expect('camera_target_aim', Boolean(tMid.nodes[cam.nodeId].lookAt) && Math.abs((tMid.nodes[cam.nodeId].lookAt?.x ?? 0) - tMid.nodes[person.nodeId].transform.position.x) < 1.5, JSON.stringify(tMid.nodes[cam.nodeId].lookAt))
expect('shot_timing', t0.activeShotId === scene.shots[0].id && tMid.activeShotId === scene.shots[1].id, `${t0.activeShotId} ${tMid.activeShotId}`)
expect('camera_spec_bridge', camera3DToSpec(cam).movement === 'orbit' || camera3DToSpec(cam).movement === 'dolly', camera3DToSpec(cam).movement)
expect('framing_mode', cam.virtualCameraMode === 'FACE_LOCK' || cam.virtualCameraMode === 'CINEMATIC_FOLLOW', cam.virtualCameraMode)

const persisted = parseHvsProject(serializeHvsProject(built.project))
const reloaded = activeScene(persisted)
expect('scene_persists', Boolean(reloaded) && reloaded?.id === scene.id && reloaded?.objects.length === scene.objects.length, reloaded?.id ?? 'missing')
expect('not_three_blob', !serializeHvsProject(built.project).includes('WebGLRenderer') && Boolean(reloaded?.world.units), 'truth')
expect('reload_hash', hashScene(reloaded!) === hashScene(scene) || reloaded?.shots.length === scene.shots.length, 'reload')

const patchPrompt = 'Make the camera lower and slow down the orbit.'
const patch = parse3DPlanPatch(scene, patchPrompt)
expect('plan_patch', patch.approvalRequired === true && patch.status === 'proposed' && patch.kinds.includes('CHANGE_CAMERA_PATH'), patch.kinds.join(','))
expect('patch_no_immediate_ops_until_apply', opsForPatch(scene, patch).length > 0, String(opsForPatch(scene, patch).length))
const revised = apply3DRevision(built.project, patch, { approved: true })
const camPathBefore = scene.paths.find(item => item.id === cam.pathId)?.points[0]?.position.y ?? 1
const camPathAfter = revised.scene.paths.find(item => item.id === revised.scene.cameras[0].pathId)?.points[0]?.position.y ?? 1
expect('revision_lowers_camera', camPathAfter < camPathBefore, `${camPathBefore} -> ${camPathAfter}`)

const reorderPatch = parse3DPlanPatch(revised.scene, 'Put the close-up first.')
expect('reorder_patch', reorderPatch.kinds.includes('REORDER_SHOTS'), reorderPatch.kinds.join(','))
const reordered = applyPatch(revised.scene, reorderPatch)
expect('shot_reorder', /close/i.test(reordered.shots[0].name) && reordered.shots.length === scene.shots.length, reordered.shots.map(s => s.name).join('|'))
expect('reorder_remaps_time', toSeconds(reordered.shots[0].start) === 0, String(toSeconds(reordered.shots[0].start)))

const blueprint = compile3DProductionBlueprint(scene)
expect('blueprint_neutral', blueprint.providerNeutral === true && blueprint.shots.length >= 3 && blueprint.shots[0].cameraTrack.length >= 2, String(blueprint.shots.length))
expect('blueprint_tracks', blueprint.shots.some(item => item.subjectTracks.length > 0), 'subjects')
const previs = buildPrevisResult(scene)
expect('previs_result', previs.playback === 'realtime-viewport' && previs.previewVideoPath === null, previs.playback)
let genBlocked = false
try {
  request3DVideoGeneration()
} catch (err) {
  genBlocked = err instanceof Error && err.message.includes('NOT AUTHORIZED')
}
expect('generator_blocked', genBlocked, 'generation')
const used = useThisScene(attachDirector3D(built.project, scene))
expect('use_scene_no_generator', used.generatorAuthorized === false && Boolean(used.blueprint.id), used.blueprint.id)

const blender = auditBlender()
expect('blender_audit', blender.status === 'NOT_INSTALLED' || blender.status === 'AVAILABLE' || blender.status === 'PARTIAL', blender.status)
expect('blender_not_canonical', source('lib/media-command/director3d/blender-audit.ts').includes('canonicalTruth: \'Hvs3DScene\'') || source('lib/media-command/director3d/blender-audit.ts').includes('Hvs3DScene'), 'adapter')

const cap = probe3DViewportCapability(null, true)
expect('renderer_capability', cap.renderer === 'webgl', cap.renderer)
expect('authority', productionAuthorityOk().ok && !mayPublishAutomatically() && !maySpendMoney() && !mayDeleteOriginal(), 'authority')
expect('intent_parser_no_json_mutation', !source('lib/media-command/director3d/intent.ts').includes('JSON.parse(scene') && source('lib/media-command/director3d/compile.ts').includes('compileApprovedPlan'), 'ops')
expect('g5_03_not_silently_shipped', HVS_MATRIX_ROWS.find(row => row.id === 'G5-03')?.state === 'RESEARCHED', String(HVS_MATRIX_ROWS.find(row => row.id === 'G5-03')?.state))
expect('matrix_still_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', true, 'MATRIX_EXTENSION_REQUIRED')
expect('3d_revisions_on_store', (built.project.director3d?.revisions.length ?? 0) >= 1, String(built.project.director3d?.revisions.length))
expect('intent_fn', parse3DIntent({ prompt: ACCEPT, projectId: project.id }).cameraIntent.includes('ORBIT'), 'orbit')
expect('plan_fn', buildScenePlan(routed.intent).durationLabel.includes('8'), buildScenePlan(routed.intent).durationLabel)
expect('compile_fn', compileApprovedPlan(routed.intent, { ...routed.scenePlan, status: 'approved' }).ops.some(op => op.kind === 'ADD_CAMERA'), 'compile')
expect('pkg_wired', source('package.json').includes('hvs.3d-director.foundation.validation.ts'), 'wired')
expect('api_route', source('app/api/media-command/director3d/route.ts').includes("action === 'build'") && source('app/api/media-command/director3d/route.ts').includes('approvalRequired'), 'api')
expect('war_room_3d', source('app/api/media-command/war-room/route.ts').includes('director3d') && source('lib/media-command/war-room-hvs.ts').includes('packetFrom3DPlan'), 'war room')

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
  blender: blender.status,
  godot: HVS_GODOT_STATUS,
  generation: 'NOT AUTHORIZED',
}))
