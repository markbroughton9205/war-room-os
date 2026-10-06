/**
 * HVS-ANIM-04 — hairline / helmet break + 85mm night inspect light.
 * `pnpm run validate:hvs-anim-groom-refine`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import {
  HVS_HUMANOID_RIG_ID,
  MATRIX_EXTENSION_REQUIRED,
  RAEL_CHARACTER_ID,
} from './digital-human/types'
import { HVS_HUMANOID_BONES, bindHumanoidRig, validateHumanoidHierarchy } from './digital-human/humanoid-rig'
import { poseAtSceneClock } from './digital-human/scene-performance'
import { HVS } from './hvs-producer-contract'
import { activeCinemaPlan } from './cinema-director/persist'
import { cinemaCamerasAlreadyBound } from './cinema-director/scene-bind'
import { HVS_VIEWPORT_INSPECT_LIGHT } from './digital-human/viewport-inspect-light'
import {
  HVS_ANIM03_TRIANGLE_COUNT,
  HVS_ANIM03_VERTEX_COUNT,
  HVS_BODY_MATERIALS,
  HVS_HEAD_GROOMING,
  HVS_HEAD_GROOM_ID,
  HVS_STYLIZED_BODY_ID,
  buildStylizedBodyGeometry,
  poseBoneWorld,
  validateSkinWeights,
} from './digital-human/skinned-body'
import { fromSeconds } from './time'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const PROJECT_ID = 'hvs-mud545ez-8w3a'
const TAKE_ID = 'take-mud7ggfd-zgdqbm'
const TAKE_TIMESCALE = 24000

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)
expect('same_character', RAEL_CHARACTER_ID === 'rael-commander', RAEL_CHARACTER_ID)
expect('same_rig', HVS_HUMANOID_RIG_ID === 'hvs-humanoid-rig-v1', HVS_HUMANOID_RIG_ID)
expect('bones_23', HVS_HUMANOID_BONES.length === 23 && validateHumanoidHierarchy().ok, String(HVS_HUMANOID_BONES.length))

const bodySrc = source('lib/media-command/digital-human/skinned-body.ts')
const preview = source('components/war-room/higher-vision-studios/HvsRaelBodyPreview.tsx')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const bindSrc = source('lib/media-command/cinema-director/scene-bind.ts')
const combined = bodySrc + preview + viewport
expect('no_second_systems', !/Groom2|Head2|HairRig|FaceRig|GroomSystem2|Character2|Rig2|LightingDirector2|hvs-humanoid-rig-v2/.test(combined), 'canonical')
expect('one_body_path', preview.includes('createHvsStylizedBody') && viewport.includes('createHvsStylizedBody'), 'shared')
expect('fallback_kept', preview.includes('Show rig proxy') && source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('hvs-show-placeholder'), 'proxy + placeholder')
expect('no_webcam', !/getUserMedia|\/dev\/video|recordPerformanceTake|face-reference|captureFace/.test(bodySrc + viewport), 'no recapture')
expect('no_cloud', !/openai|anthropic|https:\/\/api\./i.test(bodySrc), 'local')
expect('no_new_model', !/mediapipe|onnx|tensorflow|whisper/i.test(bodySrc), 'no ml')
expect('no_face_rig', HVS_HEAD_GROOMING.faces === false && !/blendshape|lipSync|eyeTracking|blinkSystem/.test(bodySrc), 'static only')
expect('no_gaze', HVS_HEAD_GROOMING.gaze === false && bodySrc.includes('userData.gaze = false'), 'neutral eyes')
expect('no_hair_physics', HVS_HEAD_GROOMING.simulated === false && !/hairSim|strandSim|secondaryMotion/.test(bodySrc), 'rigid groom')
expect('groom_parent', HVS_HEAD_GROOMING.parentBone === 'HEAD', HVS_HEAD_GROOMING.parentBone)
expect('groom_owned', HVS_HEAD_GROOMING.provenance === 'HVS-original' && HVS_HEAD_GROOMING.identityLikeness === false, HVS_HEAD_GROOM_ID)
expect('refine_pass', HVS_HEAD_GROOMING.refinePass === 'HVS-ANIM-04' && HVS_HEAD_GROOMING.version === 2, String(HVS_HEAD_GROOMING.version))
expect('hairline_notch', bodySrc.includes('leftNotch') && bodySrc.includes('rightNotch') && bodySrc.includes('function applyEarClearance'), 'helmet break')
expect('no_round_crown_cap', !bodySrc.includes('vec(0, 0.09, -0.02)), 0.07, 0.032, 0.06'), 'no bun ellipsoid')
expect('cinema_lights_untouched', bindSrc.includes("id: 'clight-ambient'") && bindSrc.includes("id: 'clight-key'") && !bindSrc.includes('hvs-execution-inspect'), 'cinema truth')
expect('inspect_light_derived', viewport.includes('HVS_VIEWPORT_INSPECT_LIGHT') && !viewport.includes('ADD_LIGHT') && HVS_VIEWPORT_INSPECT_LIGHT.mutatesCinema === false, HVS_VIEWPORT_INSPECT_LIGHT.role)
expect('inspect_shot_aware', viewport.includes('closeUpFocalMm') && viewport.includes("inspectLight = closeUp ? 'close-up' : 'night-off'"), 'shot-aware')

const started = process.hrtime.bigint()
const production = buildStylizedBodyGeometry('PRODUCTION')
const previewGeom = buildStylizedBodyGeometry('PREVIEW')
const buildMs = Number(process.hrtime.bigint() - started) / 1e6
const weights = validateSkinWeights(production)
expect('geometry_changed', production.vertexCount !== HVS_ANIM03_VERTEX_COUNT || production.triangleCount !== HVS_ANIM03_TRIANGLE_COUNT, `${production.vertexCount}v/${production.triangleCount}t vs ANIM-03 ${HVS_ANIM03_VERTEX_COUNT}/${HVS_ANIM03_TRIANGLE_COUNT}`)
expect('geometry_bounded', production.vertexCount < HVS_ANIM03_VERTEX_COUNT + 900 && production.triangleCount < HVS_ANIM03_TRIANGLE_COUNT + 1600, `${production.vertexCount - HVS_ANIM03_VERTEX_COUNT}v/${production.triangleCount - HVS_ANIM03_TRIANGLE_COUNT}t`)
expect('preview_lighter', previewGeom.vertexCount < production.vertexCount, `${previewGeom.vertexCount}<${production.vertexCount}`)
expect('skin_weights', weights.ok, JSON.stringify(weights))
expect('no_nan_geom', ![...production.positions].some(value => !Number.isFinite(value)), 'finite')
expect('build_cheap', buildMs < 400, `buildMs=${buildMs.toFixed(1)}`)
expect('hair_geometry', production.features.hairTris > 80 && production.features.hairHeadLocked > 80, JSON.stringify({ hairTris: production.features.hairTris, locked: production.features.hairHeadLocked }))
expect('hairline_updated', production.features.hairlineBreaks > 4, String(production.features.hairlineBreaks))
expect('crown_updated', production.features.crownClumps >= 6, String(production.features.crownClumps))
expect('ear_clearance', production.features.earClearance > 4 && HVS_HEAD_GROOMING.earClearance === true, String(production.features.earClearance))
expect('brow_geometry', production.features.browTris > 8, String(production.features.browTris))
expect('hair_parent_head', production.features.hairHeadLocked > 80, String(production.features.hairHeadLocked))
expect('materials', HVS_BODY_MATERIALS.includes('hair') && HVS_BODY_MATERIALS.length === 5, HVS_BODY_MATERIALS.join(','))
expect('same_body_id', HVS_STYLIZED_BODY_ID === 'hvs-stylized-body-v1', HVS_STYLIZED_BODY_ID)
expect('same_groom_id', HVS_HEAD_GROOM_ID === 'groom-hvs-stylized-head-v1', HVS_HEAD_GROOM_ID)

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const clone = cloneProject(live)
bindHumanoidRig(clone.digitalHumans!, RAEL_CHARACTER_ID)
const human = clone.digitalHumans!.characters.find(item => item.id === RAEL_CHARACTER_ID)!
expect('single_rael', clone.digitalHumans!.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(clone.digitalHumans!.characters.length))
expect('rig_bound', human.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID, human.rigBinding.skeletonRef ?? '')
expect('take_unchanged', clone.digitalHumans!.takes.some(item => item.id === TAKE_ID), TAKE_ID)
expect('mesh_metadata', human.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1'), 'mesh')
expect('groom_metadata', human.representations.some(item => item.id === 'groom-hvs-stylized-head-v1' && item.kind === '3D_MODEL' && item.assetId === null), 'groom meta')

const attached = HVS.attachDirectorPerformance(clone, clone.director3d!.scenes[0]!)
const track = attached.tracks[0]
expect('take_bound', track?.takeId === TAKE_ID && track.poses.length === 300, String(track?.poses.length ?? 0))

function poseLock(seconds: number) {
  const sample = poseAtSceneClock(track, fromSeconds(seconds, TAKE_TIMESCALE))
  const bones = ['HEAD', 'NECK', 'LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'PELVIS'] as const
  return bones.map(bone => {
    const posed = poseBoneWorld(sample.pose, bone)
    const joint = sample.pose.joints[bone]
    const match = posed.position.x === joint[0] && posed.position.y === joint[1] && posed.position.z === joint[2]
    return { bone, match }
  })
}
for (const seconds of [0, 4.4, 6.5, 8.5]) {
  const lock = poseLock(seconds)
  expect(`pose_truth_${seconds}s`, lock.every(item => item.match), lock.map(item => `${item.bone}:${item.match ? 'ok' : 'DIFF'}`).join(','))
}

const plan = activeCinemaPlan(live)
expect('cameras_intact', Boolean(plan && live.director3d?.scenes[0] && cinemaCamerasAlreadyBound(live.director3d.scenes[0], plan)), String(live.director3d?.scenes[0]?.cameras.length ?? 0))
expect('clock_untouched', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('playing={false}'), 'one clock')
expect('characters_binding', preview.includes('createHvsStylizedBody'), 'characters')
expect('director_binding', viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'director')
expect('no_baked_arrays', !serializeHvsProject(live).includes('"skinWeight"'), 'no mesh dump')

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  vertices: production.vertexCount,
  triangles: production.triangleCount,
  previewVertices: previewGeom.vertexCount,
  previewTriangles: previewGeom.triangleCount,
  anim03Vertices: HVS_ANIM03_VERTEX_COUNT,
  anim03Triangles: HVS_ANIM03_TRIANGLE_COUNT,
  features: production.features,
  materials: HVS_BODY_MATERIALS.length,
  buildMs: Number(buildMs.toFixed(2)),
  bones: 23,
  inspectLight: HVS_VIEWPORT_INSPECT_LIGHT.id,
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
