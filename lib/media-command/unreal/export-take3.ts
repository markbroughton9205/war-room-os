/**
 * Derive TAKE 3 compact poses for Unreal. Does not mutate HVS truth.
 * `node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/media-command/unreal/export-take3.ts`
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compactHumanoidPoses, humanoidPreviewPayload, leftArmTravel, rootTravel } from '../digital-human/humanoid-retarget'
import type { HvsPerformanceMotion } from '../digital-human/types'
import { mediaCommandDataHierarchy } from '../paths'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID, loadHvsProject } from './package'
import { readUnrealScenePackage } from './storage'
import { hvsUnrealSkeletonMap } from './skeleton'

const MOTION = path.join(
  mediaCommandDataHierarchy().mediaCommandRoot,
  'analysis/captures',
  HVS_UE01_PROJECT_ID,
  `${HVS_UE01_MOTION_ID}.json`,
)

function main() {
  const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
  if (!pkg) throw new Error('scene-package.json missing')
  if (!existsSync(MOTION)) throw new Error(`TAKE 3 motion missing: ${MOTION}`)
  const motion = JSON.parse(readFileSync(MOTION, 'utf8')) as HvsPerformanceMotion
  if (motion.id !== HVS_UE01_MOTION_ID) throw new Error(`unexpected motion id ${motion.id}`)
  const frames = motion.landmarkFrames ?? []
  const preview = humanoidPreviewPayload(frames)
  const poses = compactHumanoidPoses(preview.poses)
  const character = pkg.characters[0]
  const payload = {
    bridgeVersion: pkg.bridgeVersion,
    projectId: pkg.projectId,
    sceneId: pkg.sceneId,
    sourceHash: pkg.metadata.sourceHash,
    characterId: 'rael-commander',
    rigId: 'hvs-humanoid-rig-v1',
    takeId: HVS_UE01_TAKE_ID,
    motionId: HVS_UE01_MOTION_ID,
    duration: { ticks: 230769, timescale: 24000 },
    sceneDuration: { ticks: 264000, timescale: 24000 },
    blocking: character?.blockingTransform ?? { position: { x: -1.2, y: 0, z: 0.2 }, yaw: 0.2 },
    worldRoot: character?.worldRoot ?? { x: -1.2, y: 0, z: 0.2 },
    worldRootRule: 'HVS_BLOCKING_PLUS_CAPTURED_RELATIVE_ROOT',
    cameras: pkg.cameras.map(camera => ({
      shotId: camera.shotId,
      cameraSpecId: camera.cameraSpecId,
      name: camera.name,
      startTicks: camera.start.ticks,
      endTicks: camera.end.ticks,
      lensMm: camera.lensMm,
      aperture: camera.focus.aperture,
      path: camera.path,
    })),
    skeletonMap: hvsUnrealSkeletonMap(),
    qc: {
      poseCount: poses.length,
      leftArmRaise: preview.leftArmRaise,
      leftArmTravel: leftArmTravel(preview.poses),
      rootTravel: rootTravel(preview.poses),
      lowerBodyPresent: preview.lowerBodyPresent,
      maxGapTicks: 1600,
    },
    poses,
    hvsProjectPresent: Boolean(loadHvsProject(HVS_UE01_PROJECT_ID)),
    motionSha256: createHash('sha256').update(readFileSync(MOTION)).digest('hex'),
  }
  const dir = path.join(mediaCommandDataHierarchy().mediaCommandRoot, 'unreal', HVS_UE01_PROJECT_ID)
  mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'take3-execution.json')
  writeFileSync(out, `${JSON.stringify(payload)}\n`)
  console.log(JSON.stringify({
    ok: true,
    out,
    poses: poses.length,
    leftArmRaise: preview.leftArmRaise,
    leftArmTravel: payload.qc.leftArmTravel,
    rootTravel: payload.qc.rootTravel,
    lowerBodyPresent: preview.lowerBodyPresent,
    sourceHash: pkg.metadata.sourceHash,
  }, null, 2))
}

main()
