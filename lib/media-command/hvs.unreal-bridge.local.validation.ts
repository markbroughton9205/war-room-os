/**
 * HVS-UE-01 — Unreal character runtime bridge foundation.
 * `pnpm run validate:hvs-unreal-bridge`
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { HVSPROJ_VERSION, cloneProject } from './types'
import { projectFilePath } from './paths'
import { MATRIX_EXTENSION_REQUIRED, RAEL_CHARACTER_ID } from './digital-human/types'
import { HVS_HUMANOID_BONES } from './digital-human/humanoid-rig'
import { composeBlockingAndRoot } from './digital-human/scene-performance'
import { mediaTime } from './time'
import { detectUnrealRuntime, prepareUnrealCommand } from './unreal/detect'
import {
  HVS_UE01_MOTION_ID,
  HVS_UE01_PROJECT_ID,
  HVS_UE01_TAKE_ID,
  buildUnrealScenePackage,
  loadHvsProject,
  packageEmbedsBinary,
  unrealTruthBinding,
} from './unreal/package'
import { skeletonMapComplete } from './unreal/skeleton'
import { mapHvsTimeToUnreal } from './unreal/time'
import { unrealExecutionStatus, writeUnrealScenePackage } from './unreal/storage'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}
function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const started = process.hrtime.bigint()
const projectPath = projectFilePath(HVS_UE01_PROJECT_ID)
const before = readFileSync(projectPath)
const beforeHash = createHash('sha256').update(before).digest('hex')
const project = loadHvsProject(HVS_UE01_PROJECT_ID)
const trace = detectUnrealRuntime()
const first = project ? buildUnrealScenePackage(project, '2026-09-23T00:00:00.000Z') : null
const second = project ? buildUnrealScenePackage(project, '2026-09-23T11:00:00.000Z') : null
const written = first ? writeUnrealScenePackage(first) : null
const afterHash = createHash('sha256').update(readFileSync(projectPath)).digest('hex')
const unrealSrc = ['types', 'time', 'skeleton', 'detect', 'package', 'storage', 'index']
  .map(name => source(`lib/media-command/unreal/${name}.ts`)).join('\n')
const viewport = source('components/war-room/higher-vision-studios/Hvs3DViewport.tsx')
const home = source('components/war-room/higher-vision-studios/HvsHomeScreen.tsx')
const advanced = source('components/war-room/higher-vision-studios/Hvs3DDirectorScreen.tsx')
const status = unrealExecutionStatus(HVS_UE01_PROJECT_ID, trace)
const takeMap = mapHvsTimeToUnreal(mediaTime(230769, 24000))
const sceneMap = mapHvsTimeToUnreal(mediaTime(264000, 24000))
const oddMap = mapHvsTimeToUnreal(mediaTime(1, 7))
const composed = composeBlockingAndRoot({ x: 1, y: 2, z: 3 }, { x: 0.1, y: 0, z: -0.2 })
const command = prepareUnrealCommand(trace, written?.packagePath ?? 'scene-package.json')
const truth = first && written ? unrealTruthBinding(first, written.packagePath) : null
const cloned = project && truth ? cloneProject(project) : null
if (cloned && truth) cloned.unrealExecution = truth

expect('hvsproj_untouched', HVSPROJ_VERSION === 0 && beforeHash === afterHash, beforeHash.slice(0, 12))
expect('matrix_not_expanded', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('matrix_extension_required', MATRIX_EXTENSION_REQUIRED === 'MATRIX_EXTENSION_REQUIRED', MATRIX_EXTENSION_REQUIRED)
expect('same_project', first?.projectId === HVS_UE01_PROJECT_ID, first?.projectId ?? 'missing')
expect('same_character', first?.characters[0]?.characterId === RAEL_CHARACTER_ID && first.characters[0].identityId === 'rael-commander', first?.characters[0]?.characterId ?? 'missing')
expect('same_take', first?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID && first.performances[0]?.motionId === HVS_UE01_MOTION_ID, first?.performances[0]?.motionId ?? 'missing')
expect('bones_23', HVS_HUMANOID_BONES.length === 23 && skeletonMapComplete(first?.skeletonMap ?? []), String(first?.skeletonMap.length ?? 0))
expect('adapter', first?.characters[0]?.adapter === 'GENERIC_UE_HUMANOID' && first.characters[0].binding.metahumanCharacterPath === null, first?.characters[0]?.adapter ?? 'missing')
expect('binding_contract', first?.characters[0]?.binding.characterId === 'rael-commander' && first.characters[0].binding.assetState === 'NOT_BOUND', first?.characters[0]?.binding.assetState ?? 'missing')
expect('cameras', first?.cameras.length === 4 && first.cameras.map(item => item.lensMm).join(',') === '24,24,24,85', first?.cameras.map(item => item.cameraSpecId).join(',') ?? 'missing')
expect('camera_spec_preserved', Boolean(first && first.cameras.every(item => item.cameraSpecId.startsWith('cspec-'))), 'specs referenced')
expect('sequencer_derived', first?.sequencer.canonicalClock === 'HVS_MEDIA_TIME' && first.sequencer.roundTrip === 'EXPLICIT_IMPORT_REQUIRED' && first.sequencer.cameraCutSections.length === 4, first?.sequencer.levelSequenceName ?? 'missing')
expect('time_take', takeMap.exactIntegerTick && takeMap.frameNumber === 230 && takeMap.subTick === 769 && takeMap.sequencerTick.numerator === 230769, JSON.stringify(takeMap.sequencerTick))
expect('time_scene', sceneMap.exactIntegerTick && sceneMap.frameNumber === 264 && sceneMap.subTick === 0 && sceneMap.displayRate.numerator === 24 && sceneMap.tickResolution.numerator === 24000, String(sceneMap.frameNumber))
expect('time_no_float', oddMap.exactIntegerTick === false && oddMap.frameNumber === null && oddMap.sequencerTick.denominator !== 1, JSON.stringify(oddMap.sequencerTick))
expect('hash_stable', first?.metadata.sourceHash === second?.metadata.sourceHash && first?.metadata.generatedAt !== second?.metadata.generatedAt, first?.metadata.sourceHash.slice(0, 12) ?? 'missing')
expect('provenance', Boolean(first && first.metadata.sourceHash.length === 64 && first.projectId && first.sceneId && first.bridgeVersion === 'HVS-UE-01'), first?.sceneId ?? 'missing')
expect('no_binary', Boolean(first && !packageEmbedsBinary(first) && first.performances[0]?.embeddedPoseCount === 0), 'references')
expect('prototype_motion', first?.performances[0]?.label === 'PROTOTYPE_BRIDGE_FORMAT' && first.performances[0].notFinalProductionInterchange === true, first?.performances[0]?.chosen ?? 'missing')
expect('blocking_compose', composed.x === 1.1 && composed.y === 2 && composed.z === 2.8 && first?.characters[0]?.worldRootRule === 'HVS_BLOCKING_PLUS_CAPTURED_RELATIVE_ROOT', JSON.stringify(first?.characters[0]?.worldRoot))
expect('destruction_boundary', first?.destruction.integrated === false && first.destruction.rewrite === false && first.destruction.futureExecution === 'UNREAL_CHAOS', 'not integrated')
expect('lighting_boundary', Boolean(first && first.lights.every(light => light.intentOwner === 'HVS' && light.secondLightingDirector === false)), String(first?.lights.length ?? 0))
expect('environment_boundary', first?.environment[0]?.downloadedAssets === false && first.environment[0].assetRefs.length === 0, first?.environment[0]?.environmentId ?? 'missing')
expect('file_package', first?.communication.mode === 'FILE_PACKAGE' && first.communication.launch === false && command.launch === false, command.runtime)
expect('runtime_honest', trace.downloadedThisProcess === false && trace.metahumanAssets === 'NOT_FOUND', `${trace.installed}/${trace.version}`)
expect('no_cloud', !/fetch\(|axios|openai|anthropic|https:\/\/api\./i.test(unrealSrc), 'local')
expect('no_second_character', !/Character2|hvs-humanoid-rig-v2/.test(unrealSrc) && !/writeFileSync\(/.test(source('lib/media-command/unreal/detect.ts')), 'one character')
expect('three_fallback', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')") && first?.ownership.threeJs === 'BROWSER_PREVIS' && first.renderIntent.routes.PREVIS === 'THREE_JS' && first.renderIntent.routes.FINAL_HIGH_FIDELITY === 'UNREAL' && first.renderIntent.routed === false, 'previs kept')
expect('advanced_only', advanced.includes('HvsUnrealExecutionStatus') && advanced.includes('data-testid="hvs-3d-advanced"') && !home.includes('hvs-unreal-engine'), 'advanced')
expect('status', (status.engine === 'NOT_INSTALLED' || status.engine === 'DETECTED' || status.engine === 'READY') && status.scenePackage === 'READY', `${status.engine}/${status.characterBinding}/${status.scenePackage}`)
expect('truth_binding_light', Boolean(cloned && !JSON.stringify(cloned.unrealExecution).includes('embeddedPoseCount') && cloned.format === 'hvsproj' && cloned.formatVersion === 0), 'metadata only')
expect('source_of_truth', first?.ownership.hvs === 'SOURCE_OF_TRUTH' && first.ownership.hvsprojRemainsCanonical === true && first.ownership.sequencerIsDerived === true, 'hvs')

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  unreal: trace.installed,
  version: trace.version,
  projects: trace.projects.length,
  package: written?.packagePath ?? null,
  scenePackage: status.scenePackage,
  paidProviderCalls: 0,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
