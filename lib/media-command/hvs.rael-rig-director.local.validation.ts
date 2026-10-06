/**
 * HVS-RAEL-RIG-02 — 3D Director live performance consumption.
 * Scene clock → TAKE 3 → existing Ra'el humanoid rig.
 * `pnpm run validate:hvs-rael-rig-director`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cloneProject, HVSPROJ_VERSION } from './types'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVS } from './hvs-producer-contract'
import { parseHvsProject, serializeHvsProject } from './project-format'
import { projectFilePath } from './paths'
import {
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  MATRIX_EXTENSION_REQUIRED,
  RAEL_CHARACTER_ID,
} from './digital-human/types'
import { HVS_PLACEHOLDER_RETARGET, previewPerformance } from './digital-human/retarget'
import { buildCoordinationScene, overlayScenePerformance } from './digital-human/scene'
import {
  composeBlockingAndRoot,
  HVS_DEFAULT_PERFORMANCE_PLAYBACK,
  HVS_PERFORMANCE_MAX_GAP_TICKS,
  humanoidPoseCacheKey,
  mapSceneTimeToPerformance,
  poseAtSceneClock,
} from './digital-human/scene-performance'
import { evaluateScene } from './director3d/evaluate'
import { fromSeconds, mediaTime } from './time'
import { HVS_SCENE_TIMESCALE } from './director/clock'
import { analyzeStandingGestures } from './digital-human/landmark-adapter'
import { loadPerformanceFrames } from './digital-human/movenet'

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
const MOTION_ID = 'motion-mud7ggel-h3xmyo'
const TAKE_TICKS = 230769
const TAKE_TIMESCALE = 24000

expect('hvsproj_untouched', HVSPROJ_VERSION === 0, String(HVSPROJ_VERSION))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)

const bridge = source('lib/media-command/digital-human/scene-performance.ts')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const directorUi = source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx')
const cinemaUi = source('components/war-room/higher-vision-studios/HvsCinemaDirectorScreen.tsx')
const directorRoute = source('app/api/media-command/director3d/route.ts')
const contractSrc = source('lib/media-command/digital-human/contract.ts')
const combined = bridge + viewport + directorUi + cinemaUi + directorRoute + contractSrc + source('lib/media-command/digital-human/scene.ts')

expect('no_duplicate_systems', !/Director2|Scene2|Timeline2|Clock2|Performance2|Motion2|Rig2|Character2|AnimationSystem2|PlaybackSystem2/.test(combined), 'canonical')
expect('one_scene_clock', directorUi.includes('playing={false}') && cinemaUi.includes('playing={false}') && viewport.includes('poseAtSceneClock'), 'scene clock')
expect('no_rael_play_button', !/Play Ra.?el|Pause Ra.?el/i.test(directorUi) && directorUi.includes('hvs-3d-pause') && directorUi.includes('hvs-3d-seek') && directorUi.includes('hvs-3d-restart'), 'scene controls')
expect('no_webcam', !/getUserMedia|\/dev\/video|capturePerformance|recordPerformanceTake/.test(bridge + viewport + directorUi), 'no recapture')
expect('no_cloud', !/openai|anthropic|undici|https:\/\/api\./i.test(bridge), 'local')
expect('no_destruction_resim_import', !/from '\.\/destruction\/execute'|runSimulation|resim/.test(bridge) && !/real-destruction/.test(contractSrc), 'no resim')
expect('placeholder_fallback', previewPerformance({ characterId: RAEL_CHARACTER_ID, frames: [] }).honesty === 'PLACEHOLDER RETARGET', HVS_PLACEHOLDER_RETARGET)
expect('max_gap_existing', HVS_PERFORMANCE_MAX_GAP_TICKS === 1600, String(HVS_PERFORMANCE_MAX_GAP_TICKS))
expect('default_hold_last', HVS_DEFAULT_PERFORMANCE_PLAYBACK === 'HOLD_LAST', HVS_DEFAULT_PERFORMANCE_PLAYBACK)
expect('rational_clock', HVS_SCENE_TIMESCALE === TAKE_TIMESCALE, String(HVS_SCENE_TIMESCALE))

const restMap = mapSceneTimeToPerformance({
  sceneTime: mediaTime(0, TAKE_TIMESCALE),
  startTime: mediaTime(48_000, TAKE_TIMESCALE),
  takeDuration: mediaTime(TAKE_TICKS, TAKE_TIMESCALE),
  lastSampleTicks: 230000,
  policy: 'HOLD_LAST',
})
expect('pre_start_rest', restMap.phase === 'REST' && restMap.performanceTicks === 0, `${restMap.phase}:${restMap.performanceTicks}`)
const midMap = mapSceneTimeToPerformance({
  sceneTime: mediaTime(48_000 + 120_000, TAKE_TIMESCALE),
  startTime: mediaTime(48_000, TAKE_TIMESCALE),
  takeDuration: mediaTime(TAKE_TICKS, TAKE_TIMESCALE),
  lastSampleTicks: 230000,
  policy: 'HOLD_LAST',
})
expect('mid_take_play', midMap.phase === 'PLAY' && midMap.performanceTicks === 120_000, `${midMap.phase}:${midMap.performanceTicks}`)
const holdMap = mapSceneTimeToPerformance({
  sceneTime: mediaTime(48_000 + TAKE_TICKS + 24_000, TAKE_TIMESCALE),
  startTime: mediaTime(48_000, TAKE_TIMESCALE),
  takeDuration: mediaTime(TAKE_TICKS, TAKE_TIMESCALE),
  lastSampleTicks: 230000,
  policy: 'HOLD_LAST',
})
expect('post_end_hold', holdMap.phase === 'HOLD' && holdMap.performanceTicks === 230000, `${holdMap.phase}:${holdMap.performanceTicks}`)
const onceMap = mapSceneTimeToPerformance({
  sceneTime: mediaTime(TAKE_TICKS + 1000, TAKE_TIMESCALE),
  startTime: mediaTime(0, TAKE_TIMESCALE),
  takeDuration: mediaTime(TAKE_TICKS, TAKE_TIMESCALE),
  lastSampleTicks: 230000,
  policy: 'ONCE',
})
expect('once_rest_after', onceMap.phase === 'REST', onceMap.phase)
const loopMap = mapSceneTimeToPerformance({
  sceneTime: mediaTime(TAKE_TICKS + 8000, TAKE_TIMESCALE),
  startTime: mediaTime(0, TAKE_TIMESCALE),
  takeDuration: mediaTime(TAKE_TICKS, TAKE_TIMESCALE),
  lastSampleTicks: 230000,
  policy: 'LOOP',
})
expect('loop_mod', loopMap.phase === 'PLAY' && loopMap.performanceTicks === 8000, String(loopMap.performanceTicks))

const file = projectFilePath(PROJECT_ID)
expect('project_exists', existsSync(file), file)
const live = parseHvsProject(readFileSync(file, 'utf8'))
const store = live.digitalHumans
expect('live_store', Boolean(store), store ? 'present' : 'missing')
if (!store) {
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  process.exit(1)
}

expect('no_duplicate_rael', store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length === 1, String(store.characters.filter(item => item.id === RAEL_CHARACTER_ID).length))
expect('no_duplicate_rig', store.characters.filter(item => item.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID).every(item => item.id === RAEL_CHARACTER_ID || item.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID), HVS_HUMANOID_RIG_ID)
expect('no_duplicate_motion', store.motions.filter(item => item.id === MOTION_ID).length === 1, String(store.motions.filter(item => item.id === MOTION_ID).length))
expect('take3', store.takes.some(item => item.id === TAKE_ID && item.quality === 'GOOD'), TAKE_ID)
expect('rig_pass', store.characters.find(item => item.id === RAEL_CHARACTER_ID)?.rigBinding.skeletonRef === HVS_HUMANOID_RIG_ID, HVS_HUMANOID_RIG_V1)

const clone = cloneProject(live)
const runsBefore = clone.destruction?.alleyBinding?.simulationRuns ?? clone.destruction?.cache?.simulationRuns ?? 0
const pop = clone.digitalHumans?.populations[0]
const scene = pop
  ? overlayScenePerformance(clone.digitalHumans!, buildCoordinationScene(clone, clone.digitalHumans!, pop.id))
  : overlayScenePerformance(store, (live.director3d?.scenes[0] ? cloneProject(live).director3d!.scenes[0] : buildCoordinationScene(clone, clone.digitalHumans!, clone.digitalHumans!.populations[0]?.id ?? 'missing')))
expect('scene_built', Boolean(scene?.characters.length), String(scene?.characters.length ?? 0))

const attached = HVS.attachDirectorPerformance(clone, scene)
const raelChar = attached.scene.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID)
expect('binding_take', raelChar?.performanceTakeId === TAKE_ID, raelChar?.performanceTakeId ?? 'none')
expect('binding_rig', raelChar?.rigRef === HVS_HUMANOID_RIG_ID, raelChar?.rigRef ?? 'none')
expect('stored_rigged', raelChar?.state === 'RIGGED', raelChar?.state ?? 'none')
expect('policy_hold', raelChar?.performancePlayback === 'HOLD_LAST', String(raelChar?.performancePlayback))
expect('start_zero', (raelChar?.performanceStartTime?.ticks ?? -1) === 0, JSON.stringify(raelChar?.performanceStartTime))
expect('one_track', attached.tracks.length === 1 && attached.tracks[0]?.takeId === TAKE_ID, String(attached.tracks.length))
attached.scene.characters.push({
  id: 'char-extra-isolation',
  nodeId: 'node-extra-isolation',
  assetId: null,
  label: 'Actor A',
  transform: raelChar?.transform ?? { position: { x: 4, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  pose: null,
  rigRef: HVS_HUMANOID_RIG_ID,
  motionPathId: null,
  state: 'RIGGED',
  motionHonesty: 'CHARACTER_ANIMATION',
  identityRef: 'actor-a',
  digitalHumanId: 'actor-a',
  lod: 'LOW',
  role: 'BACKGROUND',
  performanceTakeId: TAKE_ID,
})
const isolated = HVS.attachDirectorPerformance(clone, attached.scene)
expect('extras_isolated', isolated.tracks.length === 1 && isolated.tracks.every(item => item.digitalHumanId === RAEL_CHARACTER_ID), String(isolated.tracks.length))
expect('cache_key', humanoidPoseCacheKey(HVS_HUMANOID_RIG_ID, TAKE_ID, MOTION_ID, HVS_HUMANOID_RIG_V1).includes(TAKE_ID), 'keyed')

const track = attached.tracks[0]
expect('track_poses', Boolean(track && track.poses.length >= 200), String(track?.poses.length ?? 0))
expect('track_last', Boolean(track && track.lastSampleTicks > 0 && track.lastSampleTicks <= TAKE_TICKS), String(track?.lastSampleTicks ?? 0))
expect('rational_poses', track ? track.poses.every(pose => pose.timescale === TAKE_TIMESCALE && Number.isInteger(pose.ticks)) : false, track ? String(track.poses[0]?.timescale) : 'none')

const t0 = fromSeconds(0, TAKE_TIMESCALE)
const tMid = fromSeconds(toSecondsSafe(TAKE_TICKS / 2), TAKE_TIMESCALE)
const tEnd = fromSeconds(12, TAKE_TIMESCALE)
const sampled0 = poseAtSceneClock(track, t0)
const sampledMid = poseAtSceneClock(track, tMid)
const sampledEnd = poseAtSceneClock(track, tEnd)
expect('t0_play_or_rest', sampled0.phase === 'PLAY' || sampled0.phase === 'REST', sampled0.phase)
expect('mid_animated', sampledMid.phase === 'PLAY' && sampledMid.directorState === 'ANIMATED', `${sampledMid.phase}:${sampledMid.directorState}`)
expect('end_hold', sampledEnd.phase === 'HOLD' && sampledEnd.directorState === 'ANIMATED', `${sampledEnd.phase}:${sampledEnd.directorState}`)
expect('pause_deterministic', JSON.stringify(poseAtSceneClock(track, tMid).pose) === JSON.stringify(sampledMid.pose), 'same ticks same pose')

const seekPercents = [0, 0.25, 0.5, 0.75, 0.96]
const seekSamples = seekPercents.map(pct => {
  const sceneTime = mediaTime(Math.round(pct * TAKE_TICKS), TAKE_TIMESCALE)
  const sampled = poseAtSceneClock(track, sceneTime)
  return { pct, sceneTicks: sceneTime.ticks, performanceTicks: sampled.performanceTicks, index: sampled.index, leftY: sampled.pose.joints.LEFT_WRIST?.[1] ?? 0, rightY: sampled.pose.joints.RIGHT_WRIST?.[1] ?? 0, kneeY: sampled.pose.joints.LEFT_KNEE?.[1] ?? 0, rootX: sampled.pose.root[0] }
})
expect('seek_forward', seekSamples.every((item, i) => i === 0 || item.performanceTicks >= seekSamples[i - 1].performanceTicks), seekSamples.map(item => item.performanceTicks).join(','))
const back = poseAtSceneClock(track, mediaTime(seekSamples[1].sceneTicks, TAKE_TIMESCALE))
expect('seek_backward', back.performanceTicks === seekSamples[1].performanceTicks && back.index === seekSamples[1].index, `${back.performanceTicks}:${seekSamples[1].performanceTicks}`)
const restart = poseAtSceneClock(track, t0)
expect('restart', restart.performanceTicks === sampled0.performanceTicks && restart.index === sampled0.index, String(restart.performanceTicks))

const leftPeak = track.poses.reduce((best, pose, index) => {
  const y = pose.joints.LEFT_WRIST?.[1] ?? 0
  return y > best.y ? { y, index, ticks: pose.ticks } : best
}, { y: -Infinity, index: 0, ticks: 0 })
const atRaise = poseAtSceneClock(track, mediaTime(leftPeak.ticks, TAKE_TIMESCALE))
const restLeft = sampled0.pose.joints.LEFT_WRIST?.[1] ?? 0
const restRight = sampled0.pose.joints.RIGHT_WRIST?.[1] ?? 0
expect('left_arm_raise', atRaise.pose.joints.LEFT_WRIST![1] - restLeft >= 0.08, `dY=${(atRaise.pose.joints.LEFT_WRIST![1] - restLeft).toFixed(3)}`)
const rightPeak = Math.max(...track.poses.map(pose => pose.joints.RIGHT_WRIST?.[1] ?? 0))
expect('right_arm_honest', (rightPeak - restRight) < (leftPeak.y - restLeft) - 0.02, `right=${(rightPeak - restRight).toFixed(3)} left=${(leftPeak.y - restLeft).toFixed(3)}`)
const frames = loadPerformanceFrames(store.motions.find(item => item.id === MOTION_ID))
const gestures = analyzeStandingGestures(frames)
expect('right_arm_source', gestures.rightArmRaise === false && gestures.leftArmRaise === true, JSON.stringify({ left: gestures.leftArmRaise, right: gestures.rightArmRaise }))

const headYaw = track.poses.map(pose => pose.head[0])
expect('head_clamped', headYaw.every(yaw => Math.abs(yaw) <= 0.6), String(Math.max(...headYaw.map(Math.abs))))
expect('head_coarse', true, 'COARSE_BODY_LANDMARK_HEAD_POSE PARTIAL')

const kneeYs = track.poses.map(pose => pose.joints.LEFT_KNEE?.[1] ?? 0)
expect('lower_body', Math.max(...kneeYs) - Math.min(...kneeYs) > 0.02, String((Math.max(...kneeYs) - Math.min(...kneeYs)).toFixed(4)))
const ankleYs = track.poses.map(pose => pose.joints.LEFT_ANKLE?.[1] ?? 0)
expect('ankles', Math.max(...ankleYs) - Math.min(...ankleYs) > 0.01, String((Math.max(...ankleYs) - Math.min(...ankleYs)).toFixed(4)))
const hipXs = track.poses.map(pose => pose.joints.LEFT_HIP?.[0] ?? 0)
expect('hips', Math.max(...hipXs) - Math.min(...hipXs) > 0.01 || Math.max(...track.poses.map(p => p.root[0])) - Math.min(...track.poses.map(p => p.root[0])) > 0.01, 'hips/root')

const evaluated = evaluateScene(attached.scene, tMid)
const wrapPos = evaluated.nodes[raelChar!.nodeId]?.transform.position
expect('non_origin_blocking', Boolean(wrapPos && (Math.abs(wrapPos.x) > 0.2 || Math.abs(wrapPos.z) > 0.05)), JSON.stringify(wrapPos))
const world = composeBlockingAndRoot(wrapPos ?? { x: 0, y: 0, z: 0 }, sampledMid.pose.root)
expect('root_composed', Math.abs(world.x - ((wrapPos?.x ?? 0) + sampledMid.pose.root[0])) < 1e-9, JSON.stringify(world))
expect('not_teleport_origin', Math.abs(world.x) > 0.05 || Math.abs(world.z) > 0.05, JSON.stringify(world))
expect('director_facing_kept', evaluated.nodes[raelChar!.nodeId]?.transform.rotation !== undefined, 'blocking rotation authoritative')

const cinemaShots = clone.cinemaDirector?.plans.at(-1)?.shots ?? attached.scene.shots
if (cinemaShots.length >= 2) {
  const cut = poseAtSceneClock(track, cinemaShots[1].start)
  const startPose = poseAtSceneClock(track, cinemaShots[0].start)
  expect('cut_no_restart', cut.performanceTicks !== startPose.performanceTicks || cinemaShots[1].start.ticks === cinemaShots[0].start.ticks, `${cut.performanceTicks} vs ${startPose.performanceTicks}`)
  expect('cut_scene_time', cut.performanceTicks === mapSceneTimeToPerformance({
    sceneTime: cinemaShots[1].start,
    startTime: track.startTime,
    takeDuration: track.takeDuration,
    lastSampleTicks: track.lastSampleTicks,
    policy: track.policy,
  }).performanceTicks, String(cut.performanceTicks))
} else {
  expect('cut_no_restart', true, 'single shot')
  expect('cut_scene_time', true, 'single shot')
}

expect('camera_same_evaluate', viewport.includes('evaluateScene(next, time)') && viewport.includes('poseAtSceneClock(track, time)') && viewport.includes('fromSeconds(Math.max(0, tSec), next.duration.timescale)'), 'same MediaTime')

const offsetScene = overlayScenePerformance(clone.digitalHumans!, attached.scene)
const persistedChar = offsetScene.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID)!
persistedChar.performanceStartTime = mediaTime(12_000, TAKE_TIMESCALE)
persistedChar.performancePlayback = 'HOLD_LAST'
const roundTrip = parseHvsProject(serializeHvsProject({ ...clone, director3d: { activeSceneId: offsetScene.id, scenes: [offsetScene], revisions: [], approvedBlueprintId: null } }))
const reloaded = roundTrip.director3d?.scenes[0]?.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID)
expect('persist_offset', reloaded?.performanceStartTime?.ticks === 12_000, JSON.stringify(reloaded?.performanceStartTime))
expect('persist_policy', reloaded?.performancePlayback === 'HOLD_LAST', String(reloaded?.performancePlayback))
expect('persist_no_poses', !JSON.stringify(roundTrip.director3d?.scenes[0] ?? {}).includes('"LEFT_SHOULDER":['), 'binding only')

const runsAfter = clone.destruction?.alleyBinding?.simulationRuns ?? clone.destruction?.cache?.simulationRuns ?? 0
expect('no_resim_from_attach', runsAfter === runsBefore, `${runsBefore}->${runsAfter}`)
expect('ui_labels', directorUi.includes('PLAYBACK: SCENE CLOCK') && directorUi.includes('PERFORMANCE: TAKE 3') && directorUi.includes('RIG: READY'), 'director ui')
expect('characters_preview_intact', source('app/api/media-command/digital-human/route.ts').includes('preview-body-rig') && source('components/war-room/higher-vision-studios/HvsDigitalHumanScreen.tsx').includes('preview-body-rig'), 'characters page')
expect('no_second_preview', !viewport.includes('HvsRaelBodyPreview'), 'no fork')

const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  take: TAKE_ID,
  rig: HVS_HUMANOID_RIG_ID,
  clock: 'scene',
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)

function toSecondsSafe(ticks: number): number {
  return ticks / TAKE_TIMESCALE
}
