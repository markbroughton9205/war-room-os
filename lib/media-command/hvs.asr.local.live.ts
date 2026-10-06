/**
 * Live spoken-media proof for local whisper.cpp ASR + captions.
 * Real speech → real transcript → real caption ops → physical MP4.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { createProject, loadProject, commitCommands, saveProject } from './store'
import { ingestFile } from './ingest'
import { applyEditCommand } from './edit-ops'
import { newCommandId } from './edit-commands'
import { processRenderQueue } from './render-engine'
import { generateJfkSpokenClip } from './test-media'
import { requestTranscription } from './asr'
import { readTranscriptSync, searchTranscript } from './transcript'
import { transcribeAsset } from './asr-runtime'
import { asrGateStatus } from './asr-gate'
import { syncWhisperModelCatalog } from './asr-catalog'
import { buildCaptionProposal, commandsForCaptionProposal, existingCaptionCount } from './production-captions'
import { parseRevisionRequest, commandsForRevisionPatch } from './production-patches'
import { parseProductionIntent } from './production-intent'
import { buildProductionPlan } from './production-ai'
import { fromSeconds, toSeconds } from './time'
import { findAsset, cloneProject } from './types'
import { resolveFfmpegTools } from './ffmpeg'
import { detectHvsProductionIntent } from './war-room-hvs-intent'
import { packetFromRevision } from './war-room-hvs'
import { emptyProductionSession } from './production-session'
import { HVS } from './hvs-producer-contract'

async function sha(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

function fail(name: string, detail: string): never {
  console.error(JSON.stringify({ ok: false, name, detail }, null, 2))
  process.exit(1)
}

const gate = asrGateStatus()
if (!gate.usableNow) fail('asr_not_ready', gate.status)
const catalog = syncWhisperModelCatalog()
if (catalog.status !== 'INSTALLED') fail('catalog', catalog.status)

const spoken = await generateJfkSpokenClip()
if (!spoken.ok) fail('spoken_clip', spoken.error ?? 'missing')

const project = await createProject({ name: 'HVS ASR Live Disposable', productionMode: 'SOCIAL' })
const ingested = await ingestFile({
  project,
  sourcePath: spoken.path,
  originalName: 'hvs-spoken-jfk.mp4',
  mimeType: 'video/mp4',
})
let live = ingested.project
const originalPath = ingested.asset.originalPath
const originalHash = await sha(originalPath)
if (!ingested.asset.immutableOriginal) fail('immutable_flag', 'original not marked immutable')

const videoTrack = live.timeline.tracks.find(track => track.kind === 'video')
if (!videoTrack) fail('video_track', 'missing')
const appended = applyEditCommand(live, {
  id: newCommandId(),
  kind: 'appendClip',
  actor: 'human',
  createdAt: new Date().toISOString(),
  trackId: videoTrack.id,
  assetId: ingested.asset.id,
  sourceIn: fromSeconds(0, live.timeline.timescale),
  sourceOut: ingested.asset.duration,
})
if (!appended.ok) fail('append', appended.error)
live = appended.project
await saveProject(live)

const first = await requestTranscription({ projectId: live.id, assetId: ingested.asset.id, language: 'en' })
if (first.job.status !== 'COMPLETED' || !first.transcript || !first.transcriptPath) {
  fail('asr_job', `${first.job.status} ${first.error ?? ''} ${first.advancedError ?? ''}`)
}
if (!existsSync(first.transcriptPath)) fail('transcript_file', first.transcriptPath)
if (!first.transcript.segments.length) fail('segments', 'empty')
const wordCount = first.transcript.segments.reduce((n, seg) => n + (seg.words?.length ?? 0), 0)
const runtimeMs = typeof first.job.outputs.runtimeMs === 'number' ? first.job.outputs.runtimeMs : null
const durationSec = toSeconds(ingested.asset.duration)
const rtf = typeof first.job.outputs.realtimeFactor === 'number' ? first.job.outputs.realtimeFactor : (runtimeMs && durationSec ? (runtimeMs / 1000) / durationSec : null)

const reloaded = readTranscriptSync(live.id, ingested.asset.id)
if (!reloaded?.segments.length) fail('reload', 'transcript missing after persist')
const hit = searchTranscript(reloaded, 'Americans')[0]
if (!hit) fail('search', reloaded.segments.map(seg => seg.text).join(' | '))
const seekSec = toSeconds(hit.timestamp)
if (seekSec < 0) fail('seek', String(seekSec))

const second = await requestTranscription({ projectId: live.id, assetId: ingested.asset.id, language: 'en' })
if (second.job.status !== 'COMPLETED') fail('cache_job', second.job.status)
if (second.cacheHit !== true && second.job.outputs.cacheHit !== true) {
  const again = await transcribeAsset({ project: live, assetId: ingested.asset.id, language: 'en' })
  if (!again.cacheHit) fail('cache_hit', JSON.stringify({ second: second.cacheHit, outputs: second.job.outputs.cacheHit, again: again.cacheHit }))
}

const intent = parseProductionIntent({
  projectId: live.id,
  prompt: 'Add captions to this spoken clip.',
  sourceAssetIds: [ingested.asset.id],
})
const plan = buildProductionPlan(live, intent)
const session = emptyProductionSession(intent)
session.plan = plan
if (detectHvsProductionIntent('Add captions.', true) !== 'captions') fail('war_room_captions', detectHvsProductionIntent('Add captions.', true))
const wrSearch = packetFromRevision(live, session, 'Find where I say Americans.', null)
if (!wrSearch.summaryLines.some(line => /Americans/i.test(line))) fail('war_room_search', wrSearch.summaryLines.join(' | '))

const revision = parseRevisionRequest({ projectId: live.id, planId: plan.id, utterance: 'Add captions. Use CLEAN captions.', project: live })
if (revision.patch.kind !== 'CHANGE_CAPTIONS') fail('caption_patch', revision.patch.kind)
const bundle = buildCaptionProposal(live, revision.request.utterance)
if (!bundle.proposals.length) fail('caption_proposal', bundle.skippedReason ?? 'none')
const ops = commandsForCaptionProposal(live, bundle)
if (!ops.length) fail('caption_ops', 'no addCaption ops')
const captioned = await commitCommands(live, ops)
if (captioned.errors.length) fail('caption_commit', captioned.errors.join(' | '))
live = captioned.project
if (existingCaptionCount(live) < 1) fail('captions_missing', 'no cues')
const blocked = buildCaptionProposal(live, 'Add captions.')
if (blocked.proposals.length !== 0) fail('silent_overwrite', String(blocked.proposals.length))

const queued = applyEditCommand(live, {
  id: newCommandId(),
  kind: 'render',
  actor: 'human',
  createdAt: new Date().toISOString(),
  aspect: live.timeline.aspect ?? '16:9',
})
if (!queued.ok) fail('queue_render', queued.error)
live = queued.project
await saveProject(live)
const processed = await processRenderQueue(live.id)
if (processed) live = processed
else live = (await loadProject(live.id)) ?? live
const last = live.renderJobs.at(-1)
if (last?.status !== 'completed') fail('render_status', `${last?.status} ${last?.error ?? ''}`)
const outputAsset = last.outputAssetId ? findAsset(live, last.outputAssetId) : null
const outputPath = outputAsset?.originalPath ?? (typeof last.outputPath === 'string' ? last.outputPath : null)
if (!outputPath || !existsSync(outputPath)) fail('physical_output', outputPath ?? 'missing')

const tools = await resolveFfmpegTools()
const probe = tools.ffprobe
  ? spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type', '-of', 'json', outputPath], { encoding: 'utf8', timeout: 15000 })
  : null
let plays = false
try {
  const parsed = JSON.parse(probe?.stdout || '{}') as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> }
  plays = Number(parsed.format?.duration ?? 0) > 1 && (parsed.streams ?? []).some(row => row.codec_type === 'video')
} catch {
  plays = false
}
if (!plays) fail('output_plays', probe?.stderr ?? 'ffprobe failed')

const afterHash = await sha(originalPath)
if (afterHash !== originalHash) fail('original_changed', originalPath)

const contract = HVS.createFromPrompt(cloneProject(live), { prompt: 'Add captions.', projectId: live.id, sourceAssetIds: [ingested.asset.id] })
if (contract.mutated) fail('contract_mutated', 'createFromPrompt mutated')

console.log(JSON.stringify({
  ok: true,
  slice: 'HVS-ASR-LOCAL-LIVE',
  projectId: live.id,
  clipDurationSec: durationSec,
  asrRuntimeMs: runtimeMs,
  realtimeFactor: rtf,
  segmentCount: reloaded.segments.length,
  wordCount,
  wordLevel: reloaded.segments.some(seg => (seg.words?.length ?? 0) > 0),
  search: { query: 'Americans', timestamp: seekSec, text: hit.text },
  captions: existingCaptionCount(live),
  outputPath,
  originalUnchanged: true,
  cacheHit: true,
  remoteCalls: first.job.outputs.remoteCalls ?? 0,
  model: catalog,
}, null, 2))
