/**
 * Live disposable-project proof for HVS AI Producer Slice 4.
 * Local ASR, captions, 16:9/9:16/1:1 variants, original immutability. No generative video.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { createProject, loadProject } from './store'
import { ingestFile } from './ingest'
import { executeVideoAnalysis } from './video-analysis'
import { applyEditCommand } from './edit-ops'
import { commitCommands, saveProject } from './store'
import { processRenderQueue } from './render-engine'
import { parseProductionIntent } from './production-intent'
import {
  applySelectorExplanation,
  buildProductionPlan,
  buildProductionResult,
  commandsAreLocalOnly,
  commandsForApprovedPlan,
  commandsForRevisionPatch,
  parseRevisionRequest,
  proveNoMutation,
} from './production-ai'
import { cloneProject, timelineDuration } from './types'
import { generateMotionPlate, generateSpokenClip, HVS_SPOKEN_FIXTURE_PHRASE } from './test-media'
import { toSeconds } from './time'
import { HVS } from './hvs-producer-contract'
import { asrEnvironmentSnapshot, asrGateStatus } from './asr-gate'
import { transcribeTimelineAssets, SLICE4_COUNTS } from './asr-runtime'
import { buildCaptionProposal, commandsForCaptionProposal, existingCaptionCount } from './production-captions'
import {
  buildProductionVariants,
  commandsForVariants,
  renderCommandsForVariants,
  syncVariantOutputs,
} from './production-variants'
import { emptyProductionSession, loadProductionSession, saveProductionSession } from './production-session'
import { resolveFfmpegTools } from './ffmpeg'
import { mediaCommandDataHierarchy } from './paths'
import { TINY_EN_SHA256 } from './whisper-install'

async function sha(file: string): Promise<string> {
  const digest = createHash('sha256')
  await pipeline(createReadStream(file), digest)
  return digest.digest('hex')
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

const asr = asrGateStatus()
if (asr.status !== 'ASR_RUNTIME_READY' && asr.status !== 'READY') fail('fixture_a', asr.status)
const modelPath = asr.snapshot.modelPath
if (!existsSync(modelPath) || createHash('sha256').update(readFileSync(modelPath)).digest('hex') !== TINY_EN_SHA256) {
  fail('model_hash', modelPath)
}

const missing = asrGateStatus(asrEnvironmentSnapshot({ modelPathOverride: '/tmp/hvs-s4-missing-tiny.en.bin' }))
if (missing.status !== 'ASR_MODEL_MISSING') fail('fixture_c_gate', missing.status)

const project = await createProject({ name: 'HVS S4 Live Disposable', productionMode: 'SOCIAL' })
const spoken = await generateSpokenClip({ seconds: 8 })
if (!spoken.ok) fail('spoken_fixture', spoken.error ?? 'spoken clip failed')
const plates = await Promise.all([
  generateMotionPlate({ seconds: 12, color: '0x102018', speed: 200 }),
  generateMotionPlate({ seconds: 12, color: '0x201018', speed: 170 }),
])
if (plates.some(item => !item.ok)) fail('plates', plates.map(item => item.error).join(' | '))

let live = project
const originals: Array<{ id: string; path: string; hash: string }> = []
const spokenIn = await ingestFile({ project: live, sourcePath: spoken.path, originalName: 's4-spoken.mp4', mimeType: 'video/mp4' })
live = spokenIn.project
originals.push({ id: spokenIn.asset.id, path: spokenIn.asset.originalPath, hash: await sha(spokenIn.asset.originalPath) })
for (const [index, plate] of plates.entries()) {
  const ingested = await ingestFile({ project: live, sourcePath: plate.path, originalName: `s4-clip-${index + 1}.mp4`, mimeType: 'video/mp4' })
  live = ingested.project
  originals.push({ id: ingested.asset.id, path: ingested.asset.originalPath, hash: await sha(ingested.asset.originalPath) })
}

const beforePlan = cloneProject(live)
const intent = parseProductionIntent({
  projectId: live.id,
  prompt: 'Make a short video from these clips.',
  sourceAssetIds: originals.map(item => item.id),
})
const contract = HVS.createFromPrompt(live, { prompt: intent.prompt, projectId: live.id, sourceAssetIds: intent.sourceAssetIds })
if (contract.mutated) fail('contract_mutated', 'createFromPrompt mutated')
if (!proveNoMutation(beforePlan, live)) fail('plan_mutation', 'plan mutated project')
SLICE4_COUNTS.WAR_ROOM_PRE_APPROVAL_MUTATION_COUNT = contract.mutated ? 1 : 0

for (const asset of live.assets.filter(item => item.kind === 'video' && !item.generated)) {
  try { await executeVideoAnalysis({ project: live, assetId: asset.id }) } catch { /* analysis optional */ }
}

const plan = applySelectorExplanation(buildProductionPlan(live, intent), commandsForApprovedPlan(live, intent, buildProductionPlan(live, intent)).selector)
const prepared = commandsForApprovedPlan(live, intent, plan)
if (!commandsAreLocalOnly(prepared.commands).ok) fail('local_only', 'non-local commands')
const cut = await commitCommands(live, prepared.commands)
if (cut.errors.length) fail('cut', cut.errors.join(' | '))
live = cut.project

const transcribed = await transcribeTimelineAssets(live)
if (!transcribed.documents.length) fail('fixture_b', transcribed.error ?? 'no transcript')
const joined = transcribed.documents.map(doc => doc.segments.map(seg => seg.text).join(' ')).join(' ').toLowerCase()
if (!/higher|vision|studio|thirty|promo|second/.test(joined)) fail('transcript_accuracy', joined)
if (joined.includes(HVS_SPOKEN_FIXTURE_PHRASE.toLowerCase()) && transcribed.documents.every(doc => doc.backend !== 'whisper.cpp')) {
  fail('fake_transcript', 'fixture text substituted')
}

const session = emptyProductionSession(intent)
session.plan = plan
session.asrStatus = transcribed.status
session.transcriptAssetIds = transcribed.documents.map(doc => doc.assetId)
session.asrWordLevel = transcribed.wordLevel
session.lastSafeVersion = live.currentVersionId
await saveProductionSession(session)

const captionBundle = buildCaptionProposal(live, 'Add captions.')
if (!captionBundle.proposals.length) fail('fixture_d', captionBundle.skippedReason ?? 'no caption proposal')
const captionOps = commandsForCaptionProposal(live, captionBundle)
if (!captionOps.length) fail('caption_ops', 'no addCaption ops')
const captioned = await commitCommands(live, captionOps)
if (captioned.errors.length) fail('caption_commit', captioned.errors.join(' | '))
live = captioned.project
if (!existingCaptionCount(live)) fail('caption_cues', 'no cues')
const blocked = buildCaptionProposal(live, 'Add captions.')
if (blocked.proposals.length) fail('fixture_f', 'silently overwrote captions')

const shorter = parseRevisionRequest({
  projectId: live.id,
  planId: plan.id,
  utterance: 'Make the opening shorter.',
  project: live,
})
const shortOps = commandsForRevisionPatch(live, shorter.patch, shorter.request.utterance, intent.durationSec)
const revised = shortOps.length ? await commitCommands(live, shortOps) : { project: live, errors: [] as string[] }
if (revised.errors.length) fail('revision', revised.errors.join(' | '))
live = revised.project

const queued = applyEditCommand(live, {
  id: `render-cap-${Date.now().toString(36)}`,
  kind: 'render',
  actor: 'ai-director',
  createdAt: new Date().toISOString(),
  aspect: '16:9',
})
if (!queued.ok) fail('caption_render_queue', queued.error)
await saveProject(queued.project)
live = queued.project
live = await processRenderQueue(live.id) ?? live
const captionJob = [...live.renderJobs].reverse().find(job => job.target.aspect === '16:9' && job.status === 'completed')
if (!captionJob?.outputAssetId) fail('fixture_e', JSON.stringify(live.renderJobs.map(job => ({ id: job.id, status: job.status, aspect: job.target.aspect, error: job.error }))))

const variants = buildProductionVariants(live, ['16:9', '9:16', '1:1'], intent.durationSec)
const reframe = commandsForVariants(live, variants)
const reframed = reframe.length ? await commitCommands(live, reframe) : { project: live, errors: [] as string[] }
if (reframed.errors.length) fail('reframe', reframed.errors.join(' | '))
live = reframed.project
for (const command of renderCommandsForVariants(variants)) {
  const next = applyEditCommand(live, command)
  if (next.ok) live = next.project
}
await saveProject(live)
live = await processRenderQueue(live.id) ?? live
const synced = syncVariantOutputs(live, variants)
session.variants = synced
session.result = buildProductionResult(live, plan, prepared.skipped, {
  durationReport: prepared.selector.durationReport,
  variants: synced,
})
await saveProductionSession(session)

const tools = await resolveFfmpegTools()
const wide = synced.find(item => item.aspect === '16:9')
const vert = synced.find(item => item.aspect === '9:16')
const square = synced.find(item => item.aspect === '1:1')
const wideProbe = wide?.outputPath ? probe(wide.outputPath, tools.ffprobe) : null
const vertProbe = vert?.outputPath ? probe(vert.outputPath, tools.ffprobe) : null
const squareProbe = square?.outputPath ? probe(square.outputPath, tools.ffprobe) : null
const wideStream = wideProbe?.streams?.find(row => row.width && row.height)
const vertStream = vertProbe?.streams?.find(row => row.width && row.height)
const squareStream = squareProbe?.streams?.find(row => row.width && row.height)
if (!wideStream || wideStream.width !== 1920 || wideStream.height !== 1080) fail('widescreen', JSON.stringify(wideProbe))
if (!vertStream || (vertStream.height ?? 0) / (vertStream.width ?? 1) < 1.5) fail('vertical', JSON.stringify(vertProbe))
if (!squareStream || squareStream.width !== squareStream.height) fail('square', JSON.stringify(squareProbe))

for (const original of originals) {
  const now = await sha(original.path)
  if (now !== original.hash) {
    SLICE4_COUNTS.ORIGINAL_MEDIA_MUTATION_COUNT += 1
    fail('immutability', original.id)
  }
}

const reloaded = await loadProject(live.id)
const reloadedSession = await loadProductionSession(live.id)
if (!reloaded || !reloadedSession?.plan || !reloadedSession.transcriptAssetIds.length) fail('fixture_m', 'session did not recover')
if (existingCaptionCount(reloaded) < 1) fail('restart_captions', 'captions missing after reload')

writeFileSync(path.join(mediaCommandDataHierarchy().cache, 'hvs-s4-live.json'), `${JSON.stringify({
  projectId: live.id,
  phrase: spoken.phrase,
  transcript: joined,
  captionCues: existingCaptionCount(live),
  variants: synced.map(item => ({ name: item.name, aspect: item.aspect, path: item.outputPath, status: item.status })),
  durationSec: toSeconds(timelineDuration(live.timeline)),
  wordLevel: transcribed.wordLevel,
}, null, 2)}\n`)

console.log(JSON.stringify({
  ok: true,
  slice: 'HVS-AI-PRODUCER-S4',
  projectId: live.id,
  asr: asr.status,
  transcript: joined,
  wordLevel: transcribed.wordLevel,
  captionCues: existingCaptionCount(live),
  durationSec: toSeconds(timelineDuration(live.timeline)),
  widescreen: wide?.outputPath,
  vertical: vert?.outputPath,
  square: square?.outputPath,
  counts: SLICE4_COUNTS,
}, null, 2))
