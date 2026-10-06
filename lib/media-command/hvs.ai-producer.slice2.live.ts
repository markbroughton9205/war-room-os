/**
 * Live disposable-project proof for HVS AI Producer Slice 2.
 * Real media, real EditOps, real Unified RenderEngine. No generative video.
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
  followUpCommandsAfterCut,
  parseRevisionRequest,
  proveNoMutation,
} from './production-ai'
import { cloneProject, findAsset, timelineDuration } from './types'
import { generateMotionPlate, generateColorPlate, generateStarrdomTestClip } from './test-media'
import { toSeconds } from './time'

async function sha(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

function fail(name: string, detail: string): never {
  console.error(JSON.stringify({ ok: false, name, detail }, null, 2))
  process.exit(1)
}

const project = await createProject({ name: 'HVS S2 Live Disposable', productionMode: 'SOCIAL' })
const clipA = await generateStarrdomTestClip()
if (!clipA.ok) fail('clip_a', clipA.error ?? 'missing')
const ingestedA = await ingestFile({ project, sourcePath: clipA.path, originalName: 's2-walk.mp4', mimeType: 'video/mp4' })
let live = ingestedA.project
const originalHash = await sha(ingestedA.asset.originalPath)
const originalPath = ingestedA.asset.originalPath

const beforePlan = cloneProject(live)
const intent = parseProductionIntent({
  projectId: live.id,
  prompt: 'Make a short video from this clip.',
  sourceAssetIds: [ingestedA.asset.id],
})
const plan = buildProductionPlan(live, intent)
if (!proveNoMutation(beforePlan, live)) fail('plan_mutation', 'plan mutated project')
if (live.timeline.tracks.find(t => t.kind === 'video')?.clips.length) fail('timeline_not_empty', 'clips before MAKE VIDEO')

await executeVideoAnalysis({ project: live, assetId: ingestedA.asset.id })
live = (await loadProject(live.id)) ?? live
const prepared = commandsForApprovedPlan(live, intent, plan)
if (!commandsAreLocalOnly(prepared.commands).ok) fail('local_only', 'forbidden command')
const first = await commitCommands(live, prepared.commands)
if (first.errors.length) fail('make_video', first.errors.join(' | '))
live = first.project
const follow = followUpCommandsAfterCut(live, intent, applySelectorExplanation(plan, prepared.selector))
if (follow.length) {
  const second = await commitCommands(live, follow)
  if (second.errors.length) fail('follow', second.errors.join(' | '))
  live = second.project
}
const clips = live.timeline.tracks.find(t => t.kind === 'video')?.clips ?? []
if (!clips.length) fail('cut_missing', 'no clips after MAKE VIDEO')

const openingDur = toSeconds(clips[0].duration)
const revision = parseRevisionRequest({
  projectId: live.id,
  planId: plan.id,
  utterance: 'Make the opening shorter.',
  project: live,
})
const revCommands = commandsForRevisionPatch(live, revision.patch, revision.request.utterance)
if (!revCommands.length) fail('revision_empty', revision.patch.summary)
const applied = await commitCommands(live, revCommands)
if (applied.errors.length) fail('revision_apply', applied.errors.join(' | '))
live = applied.project
const afterOpening = toSeconds(live.timeline.tracks.find(t => t.kind === 'video')!.clips[0].duration)
if (!(afterOpening < openingDur - 0.2)) fail('opening_not_shorter', `${openingDur} -> ${afterOpening}`)

const queued = applyEditCommand(live, {
  id: newCommandId(),
  kind: 'render',
  actor: 'human',
  createdAt: new Date().toISOString(),
  aspect: live.timeline.aspect,
})
if (!queued.ok) fail('queue_render', queued.error)
await saveProject(queued.project)
const rendered = await processRenderQueue(live.id)
if (!rendered) fail('render_missing', 'processRenderQueue returned null')
live = rendered
const job = [...live.renderJobs].reverse().find(item => item.status === 'completed')
if (!job?.outputAssetId) fail('output_job', job?.status ?? 'none')
const output = findAsset(live, job.outputAssetId)
if (!output?.originalPath || !existsSync(output.originalPath)) fail('output_file', output?.originalPath ?? 'missing')
if (await sha(originalPath) !== originalHash) fail('original_changed', originalPath)
if (output.originalPath === originalPath) fail('output_overwrote_original', output.originalPath)

const multi = await createProject({ name: 'HVS S2 Multi-clip Disposable', productionMode: 'SOCIAL' })
const plates = await Promise.all([
  generateMotionPlate({ seconds: 12, color: '0x1A120A', speed: 210 }),
  generateColorPlate({ color: '0x243044', seconds: 12 }),
  generateMotionPlate({ seconds: 12, color: '0x3A2418', speed: 140 }),
])
if (plates.some(item => !item.ok)) fail('multi_media', plates.map(item => item.error).join(' | '))
let multiProject = multi
const ids: string[] = []
for (const [index, plate] of plates.entries()) {
  const ingested = await ingestFile({
    project: multiProject,
    sourcePath: plate.path,
    originalName: `s2-multi-${index + 1}.mp4`,
    mimeType: 'video/mp4',
  })
  multiProject = ingested.project
  ids.push(ingested.asset.id)
  await executeVideoAnalysis({ project: multiProject, assetId: ingested.asset.id })
  multiProject = (await loadProject(multiProject.id)) ?? multiProject
}
const multiIntent = parseProductionIntent({
  projectId: multiProject.id,
  prompt: 'Make a 30-second video using the best parts of these clips.',
  sourceAssetIds: ids,
})
const multiPlan = buildProductionPlan(multiProject, multiIntent)
const multiPrepared = commandsForApprovedPlan(multiProject, multiIntent, multiPlan)
const multiCut = await commitCommands(multiProject, multiPrepared.commands)
if (multiCut.errors.length) fail('multi_cut', multiCut.errors.join(' | '))
multiProject = multiCut.project
const usedAssets = new Set((multiProject.timeline.tracks.find(t => t.kind === 'video')?.clips ?? []).map(clip => clip.assetId))
if (usedAssets.size < 2) fail('multi_assets', [...usedAssets].join(','))

const vertical = parseRevisionRequest({
  projectId: multiProject.id,
  planId: multiPlan.id,
  utterance: 'Make a vertical version.',
  project: multiProject,
})
const verticalOps = commandsForRevisionPatch(multiProject, vertical.patch, vertical.request.utterance)
const verticalApplied = await commitCommands(multiProject, verticalOps)
if (verticalApplied.errors.length) fail('vertical', verticalApplied.errors.join(' | '))
multiProject = verticalApplied.project
const derived = multiProject.versions.some(version => version.role === 'derived' || /vertical/i.test(version.label))
const vcam = multiProject.timeline.virtualCameras.some(cam => cam.outputAspect === '9:16')
if (!derived && !vcam) fail('vertical_variant', 'no derived version or virtual camera')
if (multiProject.assets.filter(asset => ids.includes(asset.id)).some(asset => !asset.immutableOriginal)) {
  fail('multi_originals', 'originals lost immutability')
}

console.log(JSON.stringify({
  ok: true,
  slice: 'HVS-AI-PRODUCER-S2',
  single: {
    projectId: live.id,
    clips: clips.length,
    durationSec: toSeconds(timelineDuration(live.timeline)),
    outputPath: output.originalPath,
    originalUnchanged: true,
    openingBefore: openingDur,
    openingAfter: afterOpening,
  },
  multi: {
    projectId: multiProject.id,
    assetsUsed: [...usedAssets],
    clipCount: multiProject.timeline.tracks.find(t => t.kind === 'video')?.clips.length ?? 0,
    vertical: derived || vcam,
  },
}, null, 2))
