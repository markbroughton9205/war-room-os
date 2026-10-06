/**
 * HVS-UE-04 — lit skinned Manny + IK retarget + Control Rig.
 * `pnpm run validate:hvs-unreal-retarget`
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { HVS_MATRIX_ROWS } from './production-matrix'
import { RAEL_CHARACTER_ID } from './digital-human/types'
import { detectUnrealRuntime } from './unreal/detect'
import { HVS_UE01_MOTION_ID, HVS_UE01_PROJECT_ID, HVS_UE01_TAKE_ID, HVS_UE02_UPROJECT, loadHvsProject } from './unreal/package'
import { readUnrealScenePackage } from './unreal/storage'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function expect(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
}

const started = process.hrtime.bigint()
const proofPath = '/home/chosenone/HVSRuntime/Saved/HVS/ue04-proof.json'
const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) as Record<string, unknown> : null
const captures = Array.isArray(proof?.captures) ? proof.captures as Array<Record<string, unknown>> : []
function capture(name: string) {
  return captures.find(item => item.name === name) ?? null
}
function meshOk(name: string) {
  const item = capture(name)
  const file = typeof item?.path === 'string' ? item.path : ''
  const bytes = Number(item?.bytes ?? (file && existsSync(file) ? statSync(file).size : 0))
  const buckets = Number(item?.colorBuckets ?? 0)
  const bones = item?.bones === false || item?.bones == null
  return Boolean(item && item.nonBlack === true && bytes > 25000 && buckets >= 40 && bones)
}

const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
const project = loadHvsProject(HVS_UE01_PROJECT_ID)
const viewport = readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/Hvs3DViewport.tsx'), 'utf8')
const trace = detectUnrealRuntime()
const takeCams = pkg?.cameras ?? []
const HVS_DURATION = 230769 / 24000
const duration = Number(proof?.unrealDurationSec ?? 0)
const absError = Math.abs(duration - HVS_DURATION)

expect('unreal_583', trace.installed === 'YES' && trace.version === '5.8.3', `${trace.installed}/${trace.version}`)
expect('source_ids', proof?.takeId === HVS_UE01_TAKE_ID && proof?.motionId === HVS_UE01_MOTION_ID && proof?.characterId === RAEL_CHARACTER_ID, `${proof?.takeId}/${proof?.motionId}`)
expect('source_hash', proof?.sourceHash === pkg?.metadata.sourceHash && typeof proof?.sourceHash === 'string' && String(proof.sourceHash).length === 64, String(proof?.sourceHash ?? '').slice(0, 12))
expect('hvs_ticks_untouched', proof?.hvsDurationTicks === 230769 && proof?.hvsTimescale === 24000, `${proof?.hvsDurationTicks}/${proof?.hvsTimescale}`)
expect('duration_tolerance', absError <= 1 / 24, `errMs=${(absError * 1000).toFixed(3)}`)
expect('source_anim', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3.uasset'), 'AN_Rael_Take3')
expect('derived_anim', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3_Manny.uasset'), 'AN_Rael_Take3_Manny')
expect('ik_source', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Characters/Rigs/IK_HVS_Source.uasset'), String(proof?.ikSourcePath))
expect('ik_target', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Characters/Rigs/IK_Manny_Target.uasset'), String(proof?.ikTargetPath))
expect('ik_retargeter', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Characters/Rigs/RTG_HVS_To_Manny.uasset'), String(proof?.ikRetargeterPath))
expect('control_rig', typeof proof?.controlRigPath === 'string' && (String(proof.controlRigPath).includes('CR_Mannequin') || existsSync('/home/chosenone/HVSRuntime/Content/Characters/Mannequins/Rigs/CR_Mannequin_Body.uasset')), String(proof?.controlRigPath))
expect('manny_mesh', existsSync('/home/chosenone/HVSRuntime/Content/Characters/Mannequins/Meshes/SKM_Manny_Simple.uasset'), 'SKM_Manny_Simple')
expect('shot_ticks', takeCams.map(item => `${item.start.ticks}->${item.end.ticks}`).join(',') === '0->72000,72000->144000,144000->192000,192000->264000', takeCams.map(item => item.cameraSpecId).join(','))
expect('lenses', takeCams.map(item => item.lensMm).join(',') === '24,24,24,85', takeCams.map(item => String(item.lensMm)).join(','))
expect('left_arm_mesh', meshOk('mesh_t58_left_arm'), JSON.stringify(capture('mesh_t58_left_arm')))
expect('lower_body_mesh', meshOk('mesh_t16_lower_body'), JSON.stringify(capture('mesh_t16_lower_body')))
expect('wide_mesh', meshOk('mesh_t00_wide'), JSON.stringify(capture('mesh_t00_wide')))
expect('walk_mesh', meshOk('mesh_t30_walk'), JSON.stringify(capture('mesh_t30_walk')))
expect('lookback_mesh', meshOk('mesh_t60_lookback'), JSON.stringify(capture('mesh_t60_lookback')))
expect('closeup_mesh', meshOk('mesh_t85_closeup') && Number(capture('mesh_t85_closeup')?.focalMm) === 85, JSON.stringify(capture('mesh_t85_closeup')))
expect('scrub_mesh', meshOk('mesh_t58_scrub_back'), JSON.stringify(capture('mesh_t58_scrub_back')))
expect('restart_mesh', meshOk('mesh_t00_restart'), JSON.stringify(capture('mesh_t00_restart')))
const root = Array.isArray(proof?.root) ? proof.root as Array<{ actor?: number[]; rootWorld?: number[]; handL?: number[]; boundsExtent?: number[] }> : []
expect('root_measured', root.length >= 2 && Array.isArray(root[0]?.actor) && root[0].actor?.[0] !== 0, JSON.stringify(root))
const rootDelta = Math.abs(Number(root[1]?.rootWorld?.[1] ?? 0) - Number(root[0]?.rootWorld?.[1] ?? 0))
expect('root_relative_travel', rootDelta >= 1, `dy=${rootDelta}`)
expect('mesh_standing', Number(root[1]?.boundsExtent?.[2] ?? 0) >= 70, JSON.stringify(root[1]?.boundsExtent))
expect('left_hand_raised', Number(root[1]?.handL?.[2] ?? 0) >= 80, JSON.stringify(root[1]?.handL))
expect('no_root_motion_flag', proof?.enableRootMotion === false, String(proof?.enableRootMotion))
expect('seq_exists', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a.uasset'), 'LS')
expect('capture_complete', proof?.captureComplete === true, String(proof?.captureComplete))
expect('no_metahuman', proof?.metahuman === false && !existsSync('/home/chosenone/MetaHumans'), String(proof?.metahuman))
expect('no_face', proof?.faceCapture === 'NOT_STARTED', String(proof?.faceCapture))
expect('three_js', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'previs')
expect('hvsproj', Boolean(project && project.id === HVS_UE01_PROJECT_ID), project?.id ?? 'missing')
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('uproject', existsSync(HVS_UE02_UPROJECT), HVS_UE02_UPROJECT)
expect('nanite', String(proof?.nanite || '').includes('NOT REQUIRED'), String(proof?.nanite))

const failed = results.filter(item => !item.pass)
const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  failed: failed.map(item => item.name),
  total: results.length,
  runtimeMs: Number(runtimeMs.toFixed(2)),
  duration,
  absErrorMs: Number((absError * 1000).toFixed(3)),
  proof: proofPath,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
