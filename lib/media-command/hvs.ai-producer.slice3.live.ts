/**
 * Live disposable-project proof for HVS AI Producer Slice 3.
 * Duration fill, multi-output variants, original immutability. No generative video.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createProject, loadProject } from './store'
import { ingestFile } from './ingest'
import { executeVideoAnalysis } from './video-analysis'
import { applyEditCommand } from './edit-ops'
import { newCommandId } from './edit-commands'
import { commitCommands, saveProject } from './store'
import { processRenderQueue } from './render-engine'
import { parseProductionIntent } from './production-intent'
import {
  applySelectorExplanation,
  buildProductionPlan,
  commandsAreLocalOnly,
  commandsForApprovedPlan,
  commandsForRevisionPatch,
  parseRevisionRequest,
  proveNoMutation,
} from './production-ai'
import { cloneProject, findAsset, timelineDuration } from './types'
import { generateMotionPlate } from './test-media'
import { toSeconds } from './time'
import { HVS } from './hvs-producer-contract'
import { asrGateStatus } from './asr-gate'
import {
  buildProductionVariants,
  commandsForVariants,
  renderCommandsForVariants,
  syncVariantOutputs,
} from './production-variants'
import { resolveFfmpegTools } from './ffmpeg'
import { spawnSync } from 'node:child_process'

async function sha(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

function fail(name: string, detail: string): never {
  console.error(JSON.stringify({ ok: false, name, detail }, null, 2))
  process.exit(1)
}

function probe(file: string, ffprobe: string | null) {
  if (!ffprobe || !existsSync(file)) return null
  const run = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=width,height', '-of', 'json', file], { encoding: 'utf8', timeout: 15000 })
  try { return JSON.parse(run.stdout || '{}') as { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number }> } } catch { return null }
}

const project = await createProject({ name: 'HVS S3 Live Disposable', productionMode: 'SOCIAL' })
const plates = await Promise.all([
  generateMotionPlate({ seconds: 16, color: '0x1A120A', speed: 160 }),
  generateMotionPlate({ seconds: 16, color: '0x102018', speed: 220 }),
  generateMotionPlate({ seconds: 16, color: '0x201018', speed: 190 }),
])
if (plates.some(item => !item.ok)) fail('plates', plates.map(item => item.error).join(' | '))

let live = project
const originals: Array<{ id: string; path: string; hash: string }> = []
for (const [index, plate] of plates.entries()) {
  const ingested = await ingestFile({ project: live, sourcePath: plate.path, originalName: `s3-clip-${index + 1}.mp4`, mimeType: 'video/mp4' })
  live = ingested.project
  originals.push({ id: ingested.asset.id, path: ingested.asset.originalPath, hash: await sha(ingested.asset.originalPath) })
}

const beforePlan = cloneProject(live)
const intent = parseProductionIntent({
  projectId: live.id,
  prompt: 'Make a 30-second video using the best parts of these clips.',
  sourceAssetIds: originals.map(item => item.id),
})
const contract = HVS.createFromPrompt(live, { prompt: intent.prompt, projectId: live.id, sourceAssetIds: intent.sourceAssetIds })
if (contract.mutated) fail('contract_mutated', 'createFromPrompt mutated')
if (!proveNoMutation(beforePlan, live)) fail('plan_mutation', 'plan mutated project')

for (const asset of originals) {
  await executeVideoAnalysis({ project: live, assetId: asset.id })
}
live = (await loadProject(live.id)) ?? live
const plan = buildProductionPlan(live, intent)
const prepared = commandsForApprovedPlan(live, intent, plan)
if (!commandsAreLocalOnly(prepared.commands).ok) fail('local_only', 'forbidden command')
const first = await commitCommands(live, prepared.commands)
if (first.errors.length) fail('make_video', first.errors.join(' | '))
live = first.project
const explained = applySelectorExplanation(plan, prepared.selector)
console.log(JSON.stringify({
  fillPass: prepared.selector.fillPass,
  durationReport: prepared.selector.durationReport,
  selected: prepared.selector.selected.map(item => `${item.assetId}:${item.start}-${item.end}`),
  assets: new Set(prepared.selector.selected.map(item => item.assetId)).size,
}, null, 2))
if (new Set(prepared.selector.selected.map(item => item.assetId)).size < 2) fail('multi_asset', 'did not use multiple clips')

const revision = parseRevisionRequest({
  projectId: live.id,
  planId: explained.id,
  utterance: 'Make the opening shorter.',
  project: live,
})
const revCommands = commandsForRevisionPatch(live, revision.patch, revision.request.utterance)
const revised = await commitCommands(live, revCommands)
if (revised.errors.length) fail('revision', revised.errors.join(' | '))
live = revised.project

const variants = buildProductionVariants(live, ['9:16', '1:1'], intent.durationSec)
const reframed = await commitCommands(live, commandsForVariants(live, variants))
if (reframed.errors.length) fail('reframe', reframed.errors.join(' | '))
live = reframed.project
for (const command of renderCommandsForVariants(variants)) {
  const queued = applyEditCommand(live, command)
  if (!queued.ok) fail('queue_render', queued.error)
  live = queued.project
}
await saveProject(live)
const processed = await processRenderQueue(live.id)
if (processed) live = processed
const synced = syncVariantOutputs(live, variants)
const vertical = synced.find(item => item.aspect === '9:16')
const square = synced.find(item => item.aspect === '1:1')
if (!vertical?.outputPath || !existsSync(vertical.outputPath)) fail('vertical_output', vertical?.outputPath ?? 'missing')
if (!square?.outputPath || !existsSync(square.outputPath)) fail('square_output', square?.outputPath ?? 'missing')

const tools = await resolveFfmpegTools()
const vProbe = probe(vertical.outputPath, tools.ffprobe)
const sProbe = probe(square.outputPath, tools.ffprobe)
const vStream = vProbe?.streams?.find(row => row.width && row.height)
const sStream = sProbe?.streams?.find(row => row.width && row.height)
if (!vStream?.width || !vStream.height || vStream.height / vStream.width < 1.5) fail('vertical_aspect', JSON.stringify(vStream))
if (!sStream?.width || !sStream.height || Math.abs(sStream.width - sStream.height) > 8) fail('square_aspect', JSON.stringify(sStream))

for (const original of originals) {
  const now = await sha(original.path)
  if (now !== original.hash) fail('original_changed', original.id)
}

const asr = asrGateStatus()
const timelineSec = toSeconds(timelineDuration(live.timeline))
console.log(JSON.stringify({
  ok: true,
  slice: 'HVS-AI-PRODUCER-S3',
  projectId: live.id,
  fillPass: prepared.selector.fillPass,
  durationReport: prepared.selector.durationReport,
  timelineSec,
  vertical: { path: vertical.outputPath, probe: vStream },
  square: { path: square.outputPath, probe: sStream },
  asr: asr.status,
  originalsUnchanged: true,
}, null, 2))
