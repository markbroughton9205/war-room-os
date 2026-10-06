/**
 * Server-only unified render compile. Reads originals/LUT files. Do not import from client.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { HvsProject, RenderJob, RenderTarget } from './types'
import { findAsset } from './types'
import { validateEffectGraph, WAVE9_EXECUTABLE_EFFECT_NODES } from './effect-graph'
import {
  validateColorPipeline,
  WAVE9_EXECUTABLE_COLOR_NODES,
} from './color-pipeline'
import { validateAudioGraph } from './audio-graph'
import { validateCubeFile } from './lut-cube'
import {
  CURRENT_RENDER_PIPELINE_TRACE,
  UNIFIED_RENDER_ORDER_JUSTIFICATION,
  activeUnifiedLanes,
  effectGraphBindsToAsset,
  isPassthroughEffectGraph,
  type HvsUnifiedRenderPlan,
  type UnifiedLaneValidation,
} from './unified-render-plan'

const UNSUPPORTED_EFFECT_KINDS = new Set(['Glow', 'Placeholder', 'ColorCorrect'])

export function validateUnifiedLanes(project: HvsProject): UnifiedLaneValidation {
  const errors: string[] = []
  const assetIds = new Set(project.assets.map(a => a.id))
  const subjectIds = new Set(project.timeline.subjects.map(s => s.id))
  const trackIds = new Set(project.timeline.tracks.map(t => t.id))
  const effectGraphIds: string[] = []
  const extraAssetIds: string[] = []

  for (const graph of project.effectGraphs ?? []) {
    const check = validateEffectGraph(graph, { assetIds, subjectIds })
    if (!check.ok) errors.push(`EffectGraph ${graph.id}: ${check.errors.join('; ')}`)
    const enabled = graph.nodes.filter(n => n.enabled !== false)
    for (const node of enabled) {
      if (UNSUPPORTED_EFFECT_KINDS.has(node.kind)) {
        errors.push(`EffectGraph ${graph.id} node ${node.id} kind ${node.kind} is unsupported. No silent skip.`)
      } else if (!WAVE9_EXECUTABLE_EFFECT_NODES.includes(node.kind)) {
        errors.push(`EffectGraph ${graph.id} node ${node.id} kind ${node.kind} is not executable this wave. No silent skip.`)
      }
    }
    if (!isPassthroughEffectGraph(graph)) {
      effectGraphIds.push(graph.id)
      const binds = project.timeline.tracks.some(t => t.clips.some(c => c.enabled && effectGraphBindsToAsset(graph, c.assetId)))
      if (!binds) errors.push(`EffectGraph ${graph.id} is active but binds to no enabled timeline clip. No silent skip.`)
      for (const node of enabled.filter(n => n.kind === 'MediaIn')) {
        const id = typeof node.parameters.assetId === 'string' ? node.parameters.assetId : null
        if (id && !project.timeline.tracks.some(t => t.clips.some(c => c.assetId === id))) extraAssetIds.push(id)
      }
    }
  }

  const colorCheck = validateColorPipeline(project.colorPipeline, assetIds)
  if (!colorCheck.ok) errors.push(`ColorPipeline: ${colorCheck.errors.join('; ')}`)
  for (const node of project.colorPipeline.nodes.filter(n => n.enabled)) {
    if (!WAVE9_EXECUTABLE_COLOR_NODES.includes(node.type)) {
      errors.push(`ColorPipeline node ${node.id} type ${node.type} is unsupported. No silent skip.`)
    }
    if (node.type === 'lut') {
      const file = typeof node.params.file === 'string' ? node.params.file : null
      if (!file) {
        errors.push(`ColorPipeline LUT node ${node.id} has no file.`)
      } else {
        const cube = validateCubeFile(file)
        if (!cube.ok) errors.push(`ColorPipeline LUT ${node.id}: ${cube.errors.join('; ')}`)
      }
    }
  }

  const audioCheck = validateAudioGraph(project.audioGraph, trackIds)
  if (!audioCheck.ok) errors.push(`AudioGraph: ${audioCheck.errors.join('; ')}`)

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips.filter(c => c.enabled)) {
      const asset = findAsset(project, clip.assetId)
      if (!asset) errors.push(`Missing asset ${clip.assetId} for clip ${clip.name}.`)
      else if (!existsSync(asset.originalPath) && !(asset.proxyPath && existsSync(asset.proxyPath))) {
        errors.push(`Missing original media for ${clip.name}.`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    effectGraphIds,
    colorPipelineNodeIds: project.colorPipeline.nodes.filter(n => n.enabled).map(n => n.id),
    audioGraphChannelIds: project.audioGraph.channels.map(c => c.id),
    extraAssetIds: [...new Set(extraAssetIds)],
  }
}

export function unifiedRenderStructuralHash(project: HvsProject, output: RenderTarget): string {
  const clipAssetIds = new Set(project.timeline.tracks.flatMap(t => t.clips.map(c => c.assetId)))
  const graphAssetIds = new Set(
    (project.effectGraphs ?? []).flatMap(g => g.nodes.filter(n => n.kind === 'MediaIn').map(n => String(n.parameters.assetId ?? ''))),
  )
  const sourceAssets = project.assets.filter(a => clipAssetIds.has(a.id) || graphAssetIds.has(a.id))
  const payload = {
    projectId: project.id,
    output,
    themeId: project.timeline.themeId,
    aspect: project.timeline.aspect,
    frameRate: project.timeline.frameRate,
    tracks: project.timeline.tracks.map(t => ({
      id: t.id, kind: t.kind, muted: t.muted, index: t.index,
      clips: t.clips,
      transitions: t.transitions,
    })),
    overlays: project.timeline.overlays,
    captions: project.timeline.captionTracks,
    subjects: project.timeline.subjects,
    cameras: project.timeline.virtualCameras,
    effectGraphs: project.effectGraphs,
    colorPipeline: project.colorPipeline,
    audioGraph: project.audioGraph,
    sources: sourceAssets.map(a => ({ id: a.id, checksumSha256: a.checksumSha256, originalPath: a.originalPath })),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function compileUnifiedRenderPlan(project: HvsProject, job: RenderJob): {
  ok: boolean
  plan: HvsUnifiedRenderPlan | null
  error: string | null
} {
  const started = Date.now()
  const lanes = validateUnifiedLanes(project)
  const notes = [
    CURRENT_RENDER_PIPELINE_TRACE,
    UNIFIED_RENDER_ORDER_JUSTIFICATION.effectGraph,
    UNIFIED_RENDER_ORDER_JUSTIFICATION.colorPipeline,
    UNIFIED_RENDER_ORDER_JUSTIFICATION.audioGraph,
    UNIFIED_RENDER_ORDER_JUSTIFICATION.captions,
    'HvsUnifiedRenderPlan is transient compilation. Compiled FFmpeg is not .hvsproj truth.',
  ]
  if (!lanes.ok) {
    return { ok: false, plan: null, error: lanes.errors.join(' | ') }
  }
  const structuralHash = unifiedRenderStructuralHash(project, job.target)
  const cacheKey = structuralHash.slice(0, 24)
  const active = activeUnifiedLanes(project)
  const plan: HvsUnifiedRenderPlan = {
    projectId: project.id,
    versionId: job.versionId,
    outputSpec: job.target,
    videoTrackIds: project.timeline.tracks.filter(t => t.kind === 'video' || t.kind === 'graphics').map(t => t.id),
    audioTrackIds: project.timeline.tracks.filter(t => t.kind === 'audio' || t.kind === 'video').map(t => t.id),
    effectGraphIds: lanes.effectGraphIds,
    colorPipelineNodeIds: lanes.colorPipelineNodeIds,
    audioGraphChannelIds: lanes.audioGraphChannelIds,
    audioGraphBusIds: project.audioGraph.buses.map(b => b.id),
    captionCueCount: project.timeline.captionTracks.reduce((n, t) => n + t.cues.length, 0),
    overlayCount: project.timeline.overlays.length,
    extraAssetIds: lanes.extraAssetIds,
    structuralHash,
    cacheKey,
    compileMs: Date.now() - started,
    notes,
    vfxActive: active.vfxActive,
    colorActive: active.colorActive,
    audioActive: active.audioActive,
  }
  return { ok: true, plan, error: null }
}
