/**
 * HVS-RAEL-RIG-03 — Cinema cameras on the existing 3D Director scene clock.
 * `pnpm run validate:hvs-rael-rig-camera`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import { HVS_HUMANOID_RIG_ID, MATRIX_EXTENSION_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { poseAtSceneClock } from './digital-human/scene-performance'
import { bindCinemaPlanCameras, CINEMA_SCENE_CAMERA_PREFIX, cinemaCamerasAlreadyBound } from './cinema-director/scene-bind'
import { activeCinemaPlan } from './cinema-director/persist'
import { evaluateScene } from './director3d/evaluate'
import { fromSeconds, mediaTime, toSeconds } from './time'
import { HVS_SCENE_TIMESCALE } from './director/clock'

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
const TAKE_TICKS = 230769
const TAKE_TIMESCALE = 24000

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)

const bindSrc = source('lib/media-command/cinema-director/scene-bind.ts')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const directorUi = source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx')
const combined = bindSrc + viewport + directorUi + source('app/api/media-command/director3d/route.ts')

expect('no_second_systems', !/Camera2|Director2|Timeline2|Clock2|PlaybackSystem2|Scene2/.test(combined), 'canonical')
expect('one_scene_clock', directorUi.includes('playing={false}') && viewport.includes('evaluateScene(next, time)') && viewport.includes('poseAtSceneClock(track, time)'), 'one clock')
expect('no_camera_timer', !/cameraTimer|shotTimer|performanceTimer/.test(bindSrc + directorUi) && directorUi.includes('playing={false}'), 'no camera timer')
expect('no_webcam', !/getUserMedia|\/dev\/video|recordPerformanceTake/.test(bindSrc + directorUi), 'no recapture')
expect('no_cloud', !/openai|anthropic|https:\/\/api\./i.test(bindSrc), 'local')
expect('no_resim', !/runSimulation|resim/.test(bindSrc), 'view only')
expect('orbit_no_write', viewport.includes("controls.enabled = modeNow === 'DIRECT'") && !/scene\.cameras\.\w+\s*=/.test(viewport), 'orbit isolation')
expect('rational_clock', HVS_SCENE_TIMESCALE === TAKE_TIMESCALE, String(HVS_SCENE_TIMESCALE))
expect('ui_camera', directorUi.includes('CAMERA: ') && directorUi.includes('SHOT:') && directorUi.includes('LENS:') && directorUi.includes('PLAYBACK: SCENE CLOCK'), 'ui')
expect('default_scene_camera', directorUi.includes("useState<Hvs3DViewportMode>('CAMERA')"), 'scene camera default')

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const plan = activeCinemaPlan(live)
expect('cinema_plan', Boolean(plan && plan.shots.length >= 4), String(plan?.shots.length ?? 0))
if (!plan || !live.director3d?.scenes[0]) {
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  process.exit(1)
}

const clone = cloneProject(live)
const runsBefore = clone.destruction?.alleyBinding?.simulationRuns ?? clone.destruction?.cache?.simulationRuns ?? 0
const attached = HVS.attachDirectorPerformance(clone, clone.director3d!.scenes[0]!)
const bound = bindCinemaPlanCameras(attached.scene, plan)
const again = bindCinemaPlanCameras(bound, plan)
expect('idempotent', again.cameras.length === bound.cameras.length && cinemaCamerasAlreadyBound(bound, plan), String(bound.cameras.length))
expect('camera_count', bound.cameras.length === plan.shots.length, `${bound.cameras.length}/${plan.shots.length}`)
expect('shot_count', bound.shots.length === plan.shots.length, String(bound.shots.length))
expect('spec_canonical', bound.cameras.every((camera, index) => camera.cameraSpecId === plan.shots[index].cameraSpec.id), bound.cameras.map(item => item.cameraSpecId).join(','))
expect('ids_derived', bound.cameras.every(camera => camera.id.startsWith(CINEMA_SCENE_CAMERA_PREFIX)), bound.cameras[0]?.id ?? '')
expect('target_rael', bound.cameras.every(camera => camera.target?.kind === 'NODE' && camera.target.nodeId === attached.scene.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID)?.nodeId), 'rael node')
expect('no_new_character', bound.characters.filter(item => item.digitalHumanId === RAEL_CHARACTER_ID).length === 1, String(bound.characters.length))
expect('no_new_take', clone.digitalHumans?.takes.filter(item => item.id === TAKE_ID).length === 1, 'one take')
expect('rig_unchanged', bound.characters[0]?.rigRef === HVS_HUMANOID_RIG_ID, bound.characters[0]?.rigRef ?? '')

const track = attached.tracks[0]
expect('take_bound', track?.takeId === TAKE_ID && track.poses.length === 300, String(track?.poses.length ?? 0))

const t0 = fromSeconds(0, TAKE_TIMESCALE)
const tCut = fromSeconds(3, TAKE_TIMESCALE)
const tRaise = fromSeconds(4.4, TAKE_TIMESCALE)
const t75 = fromSeconds(toSeconds(bound.duration) * 0.75, TAKE_TIMESCALE)
void t75
const eval0 = evaluateScene(bound, t0)
const evalCut = evaluateScene(bound, tCut)
const evalRaise = evaluateScene(bound, tRaise)
const pose0 = poseAtSceneClock(track, t0)
const poseCut = poseAtSceneClock(track, tCut)
const poseRaise = poseAtSceneClock(track, tRaise)
expect('shot0', eval0.activeShotId === plan.shots[0].id, eval0.activeShotId ?? '')
expect('shot_after_cut', evalCut.activeShotId === plan.shots[1].id, evalCut.activeShotId ?? '')
expect('camera_cut', eval0.activeCameraId !== evalCut.activeCameraId, `${eval0.activeCameraId} -> ${evalCut.activeCameraId}`)
expect('perf_monotonic', poseCut.performanceTicks > pose0.performanceTicks, `${pose0.performanceTicks} -> ${poseCut.performanceTicks}`)
expect('same_tick_source', evalRaise.activeShotId === plan.shots[1].id && poseRaise.performanceTicks === 105600, `${evalRaise.activeShotId}:${poseRaise.performanceTicks}`)
const restLeft = pose0.pose.joints.LEFT_WRIST?.[1] ?? 0
const raiseLeft = poseRaise.pose.joints.LEFT_WRIST?.[1] ?? 0
expect('left_arm_under_camera', raiseLeft - restLeft >= 0.08, `dY=${(raiseLeft - restLeft).toFixed(3)}`)
expect('right_arm_honest', (poseRaise.pose.joints.RIGHT_WRIST?.[1] ?? 0) < raiseLeft - 0.3, String(poseRaise.pose.joints.RIGHT_WRIST?.[1]))
expect('camera_at_T', Boolean(evalRaise.nodes[bound.cameras.find(item => item.id === evalRaise.activeCameraId)?.nodeId ?? '']), 'cam node')
expect('blocking_preserved', Math.abs((evalRaise.nodes[bound.characters[0].nodeId]?.transform.position.x ?? 0)) > 0.05, JSON.stringify(evalRaise.nodes[bound.characters[0].nodeId]?.transform.position))

const percents = [0, 0.25, 0.5, 0.75, 0.96]
const seeks = percents.map(pct => {
  const time = mediaTime(Math.round(pct * bound.duration.ticks), bound.duration.timescale)
  const evald = evaluateScene(bound, time)
  const pose = poseAtSceneClock(track, time)
  const cam = bound.cameras.find(item => item.id === evald.activeCameraId)
  const node = cam ? evald.nodes[cam.nodeId] : null
  return {
    pct,
    sceneTicks: time.ticks,
    shotId: evald.activeShotId,
    cameraId: evald.activeCameraId,
    camera: node?.transform.position ?? null,
    performanceTicks: pose.performanceTicks,
    index: pose.index,
  }
})
expect('seek_forward', seeks.every((item, i) => i === 0 || item.performanceTicks >= seeks[i - 1].performanceTicks), seeks.map(item => item.performanceTicks).join(','))
expect('seek_cameras', new Set(seeks.map(item => item.cameraId).filter(Boolean)).size >= 2, seeks.map(item => item.shotId).join(','))
const back = poseAtSceneClock(track, mediaTime(seeks[1].sceneTicks, bound.duration.timescale))
expect('seek_backward', back.performanceTicks === seeks[1].performanceTicks, String(back.performanceTicks))
const pauseA = JSON.stringify(evaluateScene(bound, tRaise).nodes)
const pauseB = JSON.stringify(evaluateScene(bound, tRaise).nodes)
expect('pause_camera', pauseA === pauseB, 'deterministic')
const restartPose = poseAtSceneClock(track, t0)
const restartCam = evaluateScene(bound, t0)
expect('restart', restartPose.performanceTicks === pose0.performanceTicks && restartCam.activeShotId === eval0.activeShotId, restartCam.activeShotId ?? '')
const cutPos = evalCut.nodes[bound.characters[0].nodeId]?.transform.position
expect('cut_no_origin', Boolean(cutPos) && Math.hypot(cutPos!.x, cutPos!.y, cutPos!.z) > 0.4, JSON.stringify(cutPos))

const started = process.hrtime.bigint()
for (let i = 0; i < 400; i++) evaluateScene(bound, fromSeconds((i % 110) / 10, TAKE_TIMESCALE))
const evalNs = Number(process.hrtime.bigint() - started)
const meanMs = evalNs / 1e6 / 400
expect('eval_cheap', meanMs < 8, `meanMs=${meanMs.toFixed(3)}`)

const runsAfter = clone.destruction?.alleyBinding?.simulationRuns ?? clone.destruction?.cache?.simulationRuns ?? 0
expect('no_resim_from_bind', runsAfter === runsBefore, `${runsBefore}->${runsAfter}`)
expect('characters_page', source('app/api/media-command/digital-human/route.ts').includes('preview-body-rig'), 'intact')
expect('no_path_cache_blob', !JSON.stringify(bound.cameras).includes('"samples"'), 'no sampled arrays')

if (!cinemaCamerasAlreadyBound(live.director3d!.scenes[0]!, plan)) {
  const persistProject = cloneProject(live)
  const persistAttached = HVS.attachDirectorPerformance(persistProject, persistProject.director3d!.scenes[0]!)
  persistProject.director3d!.scenes[0] = bindCinemaPlanCameras(persistAttached.scene, plan)
  persistProject.director3d!.activeSceneId = persistProject.director3d!.scenes[0].id
  writeFileSync(file, serializeHvsProject(persistProject), 'utf8')
}
const reloaded = parseHvsProject(readFileSync(file, 'utf8'))
expect('persisted_bindings', cinemaCamerasAlreadyBound(reloaded.director3d!.scenes[0]!, plan), String(reloaded.director3d?.scenes[0]?.cameras.length ?? 0))
expect('reload_spec', reloaded.director3d!.scenes[0]!.cameras.every((camera, index) => camera.cameraSpecId === plan.shots[index].cameraSpec.id), 'CameraSpec ids')
expect('take_still_bound', reloaded.digitalHumans?.takes.some(item => item.id === TAKE_ID) === true, TAKE_ID)

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  cameras: bound.cameras.length,
  shots: bound.shots.map(item => item.id),
  meanEvalMs: Number(meanMs.toFixed(4)),
  seeks,
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
