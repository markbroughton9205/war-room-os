/**
 * HVS-UE-03 — TAKE 3 timing fidelity + Unreal viewport visual proof.
 * `pnpm run validate:hvs-unreal-visual`
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

const HVS_DURATION = 230769 / 24000
const DISPLAY_FRAME = 1 / 24
const started = process.hrtime.bigint()
const proofPath = '/home/chosenone/HVSRuntime/Saved/HVS/ue03-proof.json'
const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) as Record<string, unknown> : null
const captures = Array.isArray(proof?.captures) ? proof.captures as Array<Record<string, unknown>> : []
function capture(name: string) {
  return captures.find(item => item.name === name) ?? null
}
function captureOk(name: string) {
  const item = capture(name)
  const file = typeof item?.path === 'string' ? item.path : ''
  const bytes = Number(item?.bytes ?? (file && existsSync(file) ? statSync(file).size : 0))
  const buckets = Number(item?.colorBuckets ?? 0)
  return Boolean(item && item.nonBlack === true && bytes > 25000 && buckets >= 40)
}
const pkg = readUnrealScenePackage(HVS_UE01_PROJECT_ID)
const project = loadHvsProject(HVS_UE01_PROJECT_ID)
const viewport = readFileSync(path.join(process.cwd(), 'components/war-room/higher-vision-studios/Hvs3DViewport.tsx'), 'utf8')
const trace = detectUnrealRuntime()
const duration = Number(proof?.unrealDurationSec ?? 0)
const absError = Math.abs(duration - HVS_DURATION)
const takeCams = pkg?.cameras ?? []

expect('unreal_583', trace.installed === 'YES' && trace.version === '5.8.3', `${trace.installed}/${trace.version}`)
expect('duration_measured', Boolean(proof && typeof proof.unrealDurationSec === 'number' && proof.unrealDurationSec > 0), JSON.stringify(proof?.unrealDurationSec ?? null))
expect('duration_tolerance', absError <= DISPLAY_FRAME, `hvs=${HVS_DURATION} ue=${duration} errMs=${(absError * 1000).toFixed(3)} frame24=${(absError * 24).toFixed(4)}`)
expect('sample_grid', proof?.frameRate === 60 && Number(proof?.sampleCount) === 576, `${proof?.frameRate}/${proof?.sampleCount}`)
expect('method_resample', proof?.method === 'resample_slerp_60fps', String(proof?.method))
expect('source_ids', proof?.takeId === HVS_UE01_TAKE_ID && proof?.motionId === HVS_UE01_MOTION_ID && proof?.characterId === RAEL_CHARACTER_ID, `${proof?.takeId}/${proof?.motionId}`)
expect('source_hash', proof?.sourceHash === pkg?.metadata.sourceHash && typeof proof?.sourceHash === 'string' && String(proof.sourceHash).length === 64, String(proof?.sourceHash ?? '').slice(0, 12))
expect('hvs_ticks_untouched', proof?.hvsDurationTicks === 230769 && proof?.hvsTimescale === 24000, `${proof?.hvsDurationTicks}/${proof?.hvsTimescale}`)
expect('anim_exists', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Animation/AN_Rael_Take3.uasset'), 'AN_Rael_Take3')
expect('seq_exists', existsSync('/home/chosenone/HVSRuntime/Content/HVS/Sequences/LS_HVS_hvs_mud545ez_8w3a.uasset'), 'LS')
expect('shot_ticks', takeCams.map(item => `${item.start.ticks}->${item.end.ticks}`).join(',') === '0->72000,72000->144000,144000->192000,192000->264000', takeCams.map(item => item.cameraSpecId).join(','))
expect('lenses', takeCams.map(item => item.lensMm).join(',') === '24,24,24,85', takeCams.map(item => String(item.lensMm)).join(','))
expect('left_arm_visual', captureOk('vis_t58_left_arm'), JSON.stringify(capture('vis_t58_left_arm')))
expect('lower_body_visual', captureOk('vis_t16_lower_body'), JSON.stringify(capture('vis_t16_lower_body')))
expect('wide_visual', captureOk('vis_t00_wide'), JSON.stringify(capture('vis_t00_wide')))
expect('walk_visual', captureOk('vis_t30_walk'), JSON.stringify(capture('vis_t30_walk')))
expect('lookback_visual', captureOk('vis_t60_lookback'), JSON.stringify(capture('vis_t60_lookback')))
expect('closeup_visual', captureOk('vis_t85_closeup') && Number(capture('vis_t85_closeup')?.focalMm) === 85, JSON.stringify(capture('vis_t85_closeup')))
expect('closeup_boundary', captureOk('vis_t80_closeup'), JSON.stringify(capture('vis_t80_closeup')))
expect('scrub_visual', captureOk('vis_t58_scrub_back'), JSON.stringify(capture('vis_t58_scrub_back')))
expect('restart_visual', captureOk('vis_t00_restart'), JSON.stringify(capture('vis_t00_restart')))
const root = Array.isArray(proof?.root) ? proof.root as Array<{ actor?: number[]; rootWorld?: number[] }> : []
expect('root_measured', root.length >= 2 && Array.isArray(root[0]?.actor) && root[0].actor?.[0] !== 0, JSON.stringify(root))
const rootDelta = Math.abs(Number(root[1]?.rootWorld?.[1] ?? 0) - Number(root[0]?.rootWorld?.[1] ?? 0))
expect('root_relative_travel', rootDelta >= 1, `dy=${rootDelta}`)
expect('capture_complete', proof?.captureComplete === true, String(proof?.captureComplete))
expect('no_metahuman', proof?.metahuman === false && !existsSync('/home/chosenone/MetaHumans'), String(proof?.metahuman))
expect('no_face', proof?.faceCapture === 'NOT_STARTED', String(proof?.faceCapture))
expect('three_js', viewport.includes("from 'three'") && viewport.includes("createHvsStylizedBody('PRODUCTION')"), 'previs')
expect('hvsproj', Boolean(project && project.id === HVS_UE01_PROJECT_ID), project?.id ?? 'missing')
expect('matrix_187', HVS_MATRIX_ROWS.length === 187, String(HVS_MATRIX_ROWS.length))
expect('uproject', existsSync(HVS_UE02_UPROJECT), HVS_UE02_UPROJECT)

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
