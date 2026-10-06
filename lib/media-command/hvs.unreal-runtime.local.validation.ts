/**
 * HVS-UE-02 — Unreal execution runtime.
 * `pnpm run validate:hvs-unreal-runtime`
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { RAEL_CHARACTER_ID } from './digital-human/types'
import { HVS_HUMANOID_BONES } from './digital-human/humanoid-rig'
import { detectUnrealRuntime } from './unreal/detect'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID, HVS_UE02_UPROJECT, loadHvsProject } from './unreal/package'
import { hvsUnrealSkeletonMap, skeletonMapComplete } from './unreal/skeleton'
import { readUnrealScenePackage } from './unreal/storage'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const started = process.hrtime.bigint()
const trace = detectUnrealRuntime()
const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
const binding = pkg?.characters[0]?.binding
const proofPath = '/home/chosenone/HVSRuntime/Saved/HVS/ue02-import-proof.json'
const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) as Record<string, unknown> : null
const project = loadHvsProject(HVS_UE01_PROJECT_ID)
const viewport = readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/Hvs3DViewport.tsx'), 'utf8')
const animAsset = '/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3.uasset'
const seqAsset = '/home/chosenone/HVSRuntime/Content/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a.uasset'
const mapAsset = '/home/chosenone/HVSRuntime/Content/HVS/Maps/HVS_Execution_Test.umap'
const importer = '/home/chosenone/HVSRuntime/Scripts/hvs_ue02_import.py'
const take3 = path.join(process.env.HOME ?? '/home/chosenone', '.local/share/war-room-os/data/media-command/unreal', HVS_UE01_PROJECT_ID, 'take3-execution.json')
const take = existsSync(take3) ? JSON.parse(readFileSync(take3, 'utf8')) as { duration?: { ticks: number }; qc?: { leftArmRaise?: boolean; lowerBodyPresent?: boolean }; poses?: unknown[]; cameras?: Array<{ lensMm: number; startTicks: number; endTicks: number; cameraSpecId: string }> } : null
const cameras = take?.cameras ?? pkg?.cameras ?? []

expect('unreal_583', trace.installed === 'YES' && trace.version === '5.8.3' && Boolean(trace.editorPath?.includes('/home/chosenone/Unreal/')), `${trace.installed}/${trace.version}/${trace.editorPath}`)
expect('hvruntime_uproject', existsSync(HVS_UE02_UPROJECT), HVS_UE02_UPROJECT)
expect('canonical_path', HVS_UE02_UPROJECT === '/home/chosenone/HVSRuntime/HVSRuntime.uproject', HVS_UE02_UPROJECT)
expect('importer', existsSync(importer) && readFileSync(importer, 'utf8').includes('AN_Rael_Take3'), importer)
expect('take3_export', Boolean(take && take.poses && take.poses.length === 300 && take.duration?.ticks === 230769), String(take?.poses?.length ?? 0))
expect('left_arm', take?.qc?.leftArmRaise === true, JSON.stringify(take?.qc ?? null))
expect('lower_body', take?.qc?.lowerBodyPresent === true, JSON.stringify(take?.qc ?? null))
expect('bones_23', HVS_HUMANOID_BONES.length === 23 && skeletonMapComplete(hvsUnrealSkeletonMap()), String(HVS_HUMANOID_BONES.length))
expect('same_ids', pkg?.characters[0]?.characterId === RAEL_CHARACTER_ID && pkg?.characters[0]?.performanceTakeId === HVS_UE01_TAKE_ID && pkg?.performances[0]?.motionId === HVS_UE01_MOTION_ID, `${pkg?.characters[0]?.characterId}/${pkg?.characters[0]?.performanceTakeId}`)
expect('four_cameras', cameras.length === 4 && cameras.map(item => item.lensMm).join(',') === '24,24,24,85', cameras.map(item => `${item.lensMm}`).join(','))
expect('shot_ticks', cameras.map(item => { const t = item as { startTicks?: number; endTicks?: number; start?: { ticks: number }; end?: { ticks: number } }; return `${t.startTicks ?? t.start?.ticks}->${t.endTicks ?? t.end?.ticks}` }).join(',') === '0->72000,72000->144000,144000->192000,192000->264000', cameras.map(item => item.cameraSpecId).join(','))
expect('display_tick', pkg?.sequencer.displayRate.numerator === 24 && pkg?.sequencer.tickResolution.numerator === 24000 && pkg?.duration.ticks === 264000, JSON.stringify(pkg?.sequencer.displayRate))
expect('anim_asset', existsSync(animAsset), animAsset)
expect('sequence_asset', existsSync(seqAsset), seqAsset)
expect('map_asset', existsSync(mapAsset), mapAsset)
expect('binding_paths', Boolean(binding && binding.assetState === 'BOUND' && binding.unrealActorPath && binding.skeletalMeshPath && binding.skeletonPath && binding.animationSequencePath && binding.levelSequencePath && binding.mapPath && binding.uprojectPath === HVS_UE02_UPROJECT), JSON.stringify(binding ?? null))
expect('no_metahuman', binding?.metahumanCharacterPath == null && proof?.metahuman === false, String(binding?.metahumanCharacterPath))
expect('no_face', proof?.faceCapture === 'NOT_STARTED' || !proof, String(proof?.faceCapture))
expect('three_js', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'previs')
expect('hvsproj_present', Boolean(project && project.id === HVS_UE01_PROJECT_ID), project?.id ?? 'missing')
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('proof_ok', proof?.ok === true, JSON.stringify(proof?.errors ?? proof))
expect('no_cloud_character', !existsSync('/home/chosenone/MetaHumans') && !existsSync(path.join(path.dirname(HVS_UE02_UPROJECT), 'Content/MetaHumans')), 'no metahuman dir')

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  version: trace.version,
  uproject: HVS_UE02_UPROJECT,
  proof: proofPath,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
