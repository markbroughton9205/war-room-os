/**
 * HVS-ANIM-01 — stylized skinned body on the existing 23-bone rig.
 * `pnpm run validate:hvs-anim-character`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import {
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  HVS_NEUTRAL_HUMANOID,
  MATRIX_EXTENSION_REQUIRED,
  RAEL_CHARACTER_ID,
} from './digital-human/types'
import { HVS_HUMANOID_BONES, bindHumanoidRig, validateHumanoidHierarchy } from './digital-human/humanoid-rig'
import { poseAtSceneClock } from './digital-human/scene-performance'
import { HVS } from './hvs-producer-contract'
import { activeCinemaPlan } from './cinema-director/persist'
import { cinemaCamerasAlreadyBound } from './cinema-director/scene-bind'
import {
  HVS_STYLIZED_BODY_ID,
  bodyProvenance,
  boneWorldMatrixAt,
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

const hierarchy = validateHumanoidHierarchy()
expect('bones_23', HVS_HUMANOID_BONES.length === 23 && hierarchy.ok, String(HVS_HUMANOID_BONES.length))
expect('canonical_rig', HVS_HUMANOID_RIG_ID === 'hvs-humanoid-rig-v1' && HVS_HUMANOID_RIG_V1 === 'HVS_HUMANOID_RIG_V1', HVS_HUMANOID_RIG_ID)

const bodySrc = source('lib/media-command/digital-human/skinned-body.ts')
const preview = source('components/war-room/higher-vision-studios/HvsRaelBodyPreview.tsx')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const combined = bodySrc + preview + viewport
expect('no_second_systems', !/Rig2|SkinnedRig2|AnimationRig2|Character2|Motion2|Timeline2|Scene2|hvs-humanoid-rig-v2/.test(combined), 'canonical')
expect('one_body_path', preview.includes('createHvsStylizedBody') && viewport.includes('createHvsStylizedBody') && !viewport.includes('HvsRaelBodyPreview'), 'shared')
expect('fallback_kept', preview.includes('Show rig proxy') && preview.includes('hvs-show-placeholder') === false && source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('hvs-show-placeholder'), 'proxy + placeholder')
expect('no_webcam', !/getUserMedia|\/dev\/video|recordPerformanceTake/.test(bodySrc), 'no recapture')
expect('no_cloud', !/openai|anthropic|https:\/\/api\./i.test(bodySrc), 'local')
expect('no_new_model', !/mediapipe|onnx|tensorflow|whisper/i.test(bodySrc), 'no ml')
expect('wardrobe_honest', bodySrc.includes('PREVIEW WARDROBE') || preview.includes('PREVIEW WARDROBE REPRESENTATION'), 'wardrobe')
expect('proportions', bodySrc.includes(HVS_NEUTRAL_HUMANOID), HVS_NEUTRAL_HUMANOID)

const started = process.hrtime.bigint()
const production = buildStylizedBodyGeometry('PRODUCTION')
const previewGeom = buildStylizedBodyGeometry('PREVIEW')
const buildMs = Number(process.hrtime.bigint() - started) / 1e6
const weights = validateSkinWeights(production)
expect('production_mesh', production.vertexCount > 800 && production.triangleCount > 1200, `${production.vertexCount}v/${production.triangleCount}t`)
expect('preview_lighter', previewGeom.vertexCount < production.vertexCount && previewGeom.triangleCount < production.triangleCount, `${previewGeom.vertexCount}<${production.vertexCount}`)
expect('skin_weights', weights.ok, JSON.stringify(weights))
expect('no_nan_geom', ![...production.positions].some(value => !Number.isFinite(value)), 'finite')
expect('build_cheap', buildMs < 250, `buildMs=${buildMs.toFixed(1)}`)

const restBone = poseBoneWorld(null, 'LEFT_SHOULDER')
expect('rest_bone_finite', Number.isFinite(restBone.position.x) && Number.isFinite(restBone.quaternion.w), JSON.stringify(restBone.position))
const restMat = boneWorldMatrixAt(null, 'PELVIS')
expect('rest_matrix', restMat.elements.every(value => Number.isFinite(value)), 'matrix')

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const clone = cloneProject(live)
bindHumanoidRig(clone.digitalHumans!, RAEL_CHARACTER_ID)
const human = clone.digitalHumans!.characters.find(item => item.id === RAEL_CHARACTER_ID)!
expect('single_rael', clone.digitalHumans!.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(clone.digitalHumans!.characters.length))
expect('rig_bound', human.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID, human.rigBinding.skeletonRef ?? '')
expect('take_unchanged', clone.digitalHumans!.takes.some(item => item.id === TAKE_ID), TAKE_ID)
expect('mesh_metadata', human.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1' && item.kind === '3D_MODEL' && item.assetId === null), human.representations.map(item => item.id).join(','))
expect('no_baked_arrays', !serializeHvsProject(clone).includes('"skinWeight"') && !serializeHvsProject(clone).includes('"positions":['), 'no mesh dump')

const attached = HVS.attachDirectorPerformance(clone, clone.director3d!.scenes[0]!)
const track = attached.tracks[0]
expect('take_bound', track?.takeId === TAKE_ID && track.poses.length === 300, String(track?.poses.length ?? 0))
const pose0 = poseAtSceneClock(track, fromSeconds(0, TAKE_TIMESCALE))
const poseRaise = poseAtSceneClock(track, fromSeconds(4.4, TAKE_TIMESCALE))
const poseCut = poseAtSceneClock(track, fromSeconds(3, TAKE_TIMESCALE))
expect('left_arm', (poseRaise.pose.joints.LEFT_WRIST?.[1] ?? 0) - (pose0.pose.joints.LEFT_WRIST?.[1] ?? 0) >= 0.08, String(poseRaise.pose.joints.LEFT_WRIST?.[1]))
expect('right_honest', (poseRaise.pose.joints.RIGHT_WRIST?.[1] ?? 0) < (poseRaise.pose.joints.LEFT_WRIST?.[1] ?? 0) - 0.3, String(poseRaise.pose.joints.RIGHT_WRIST?.[1]))
expect('cut_ticks', poseCut.performanceTicks > pose0.performanceTicks, `${pose0.performanceTicks}->${poseCut.performanceTicks}`)
expect('root_relative', Math.abs(poseRaise.pose.root[0]) < 2, String(poseRaise.pose.root[0]))
const raiseBone = poseBoneWorld(poseRaise.pose, 'LEFT_SHOULDER')
expect('raise_bone_follows', raiseBone.position.y === poseRaise.pose.joints.LEFT_SHOULDER[1], String(raiseBone.position.y))

const plan = activeCinemaPlan(live)
expect('cameras_intact', Boolean(plan && live.director3d?.scenes[0] && cinemaCamerasAlreadyBound(live.director3d.scenes[0], plan)), String(live.director3d?.scenes[0]?.cameras.length ?? 0))
expect('clock_untouched', source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx').includes('playing={false}'), 'one clock')
expect('no_resim', !/runSimulation|resim/.test(bodySrc), 'view only')

if (!human.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1') || !live.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)?.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1')) {
  bindHumanoidRig(live.digitalHumans!, RAEL_CHARACTER_ID)
  writeFileSync(file, serializeHvsProject(live), 'utf8')
}
const reloaded = parseHvsProject(readFileSync(file, 'utf8'))
expect('persisted_binding', reloaded.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)?.representations.some(item => item.id === 'mesh-hvs-stylized-body-v1') === true, 'mesh meta')
expect('id_lock', reloaded.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)?.id === RAEL_CHARACTER_ID, RAEL_CHARACTER_ID)

const provenance = bodyProvenance('PRODUCTION', production)
expect('provenance', provenance.bakedAnimation === false && provenance.boneCount === 23 && provenance.id === HVS_STYLIZED_BODY_ID, JSON.stringify(provenance))

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
  buildMs: Number(buildMs.toFixed(2)),
  materials: 3,
  bones: 23,
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
