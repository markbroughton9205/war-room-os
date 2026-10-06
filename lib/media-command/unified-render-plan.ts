/**
 * Transient unified render compilation. NOT project truth.
 * Do not persist compiled FFmpeg strings on .hvsproj.
 *
 * CURRENT RENDER PIPELINE (Wave-5 / Phase-1, audited before Wave-6 insertion)
 * --------------------------------------------------------------------------
 * processRenderQueue:
 *   load project → queued jobs → running → renderTimeline → ffprobe gate →
 *   copy into originals as generated AssetRecord → completed.
 *   Failures: missing ffmpeg = blocked; render/probe reject = failed.
 *   Originals are never deleted. Versions are never overwritten by a render.
 *
 * renderTimeline:
 *   1. Traverse unmuted video/graphics tracks, enabled clips, start-sorted.
 *   2. Unique -i originals (proxy fallback only if original missing).
 *   3. color=c=0x080604 WxH duration fps  [base]
 *   4. Per clip video (clipVideoFilter):
 *        trim/setpts
 *        → reverse?
 *        → setpts speed
 *        → freeze loop/fps
 *        → geometry (9:16 VirtualCamera crop lerp ELSE scale+pad)
 *        → clip.crop
 *        → clip.transform scale/rotate
 *        → look (clip ColorGrade + FilterSpec ELSE theme look)
 *        → dissolve alpha fade OR opacity
 *        → format yuv420p → fps → optional setpts timelineStart
 *   5. Per track: tpad / xfade (dissolveWindowFor + xfadePrepareChain CFR) / overlay-between
 *   6. Overlay each track onto last
 *   7. Rasterize title/logo overlays → overlay enable='between(...)'
 *   8. ASS captions (writeAssFile) or format=yuv420p [vout]
 *   9. Audio clips (video+audio unmuted tracks, skip freeze):
 *        atrim/asetpts → areverse? → atempo → volume → pan → afade in/out
 *        → dissolve afade → adelay → aformat stereo
 *      then amix normalize=0 + apad [aout]
 *  10. -map [vout] -map [aout] h264+aac -t duration +faststart
 *
 * JUSTIFIED WAVE-6 INSERTION (do not blindly follow conceptual CLIP→VFX→COLOR→AUDIO→CAPTIONS)
 * -------------------------------------------------------------------------------------------
 * EffectGraph:  after clip look, before opacity/dissolve, on the clip whose
 *               assetId matches an enabled MediaIn.assetId. Opacity/dissolve must
 *               fade the VFX result. Extra MediaIn (Merge) → extra -i.
 *               Binding is MediaIn.assetId + Mask/TrackerRef.subjectId on persisted
 *               TrackSubject. No Studio UI selection at render time.
 * ColorPipeline: after track composite (program grade), BEFORE titles/logos/ASS
 *               so captions sit on the graded program. Clip ColorGrade remains
 *               in the look step (Phase-1 compatibility). nodes[] authoring order.
 *               Luma qualifier uses maskedmerge via filter_complex_script
 *               (unescaped X,Y — Wave-4 CLI X\,Y bug must not return).
 * AudioGraph:   after clip audio processing, replacing simple amix+apad [aout].
 *               Clip volume/pan/fade/duck stay first. Then channel → submix → master.
 * Captions/titles/graphics stay after VFX+color (existing order, preserved).
 */
import type { HvsProject, RenderTarget } from './types'
import type { HvsEffectGraph } from './effect-graph'
import {
  type ColorPipeline,
} from './color-pipeline'
import { type AudioGraph } from './audio-graph'

export const CURRENT_RENDER_PIPELINE_TRACE = `
timeline traversal → clip trim/reverse/speed/freeze → geometry/crop/transform
→ Phase-1 ColorGrade look → [WAVE6 EffectGraph] → opacity/dissolve
→ track xfade/overlay → [WAVE6 ColorPipeline program grade + qualifier/LUT]
→ titles/logos → ASS captions → [vout]
clip audio volume/pan/fade/duck → [WAVE6 AudioGraph channel/submix/master] → [aout]
`.trim()

export const UNIFIED_RENDER_ORDER_JUSTIFICATION = {
  effectGraph: 'After clip look, before opacity/dissolve so VFX is in the clip raster that fades/composites.',
  colorPipeline: 'After track composite, before overlays/captions. COLOR page is a program grade; clip ColorGrade stays Phase-1 compatible.',
  audioGraph: 'After clip processing. Clip mix is not the master. Channel → submix → master with repaired limiter.',
  captions: 'After VFX+color so text is not re-graded. Existing ASS path.',
} as const

export type HvsUnifiedRenderPlan = {
  projectId: string
  versionId: string
  outputSpec: RenderTarget
  videoTrackIds: string[]
  audioTrackIds: string[]
  effectGraphIds: string[]
  colorPipelineNodeIds: string[]
  audioGraphChannelIds: string[]
  audioGraphBusIds: string[]
  captionCueCount: number
  overlayCount: number
  extraAssetIds: string[]
  structuralHash: string
  cacheKey: string
  compileMs: number
  notes: string[]
  vfxActive: boolean
  colorActive: boolean
  audioActive: boolean
}

export type UnifiedLaneValidation = {
  ok: boolean
  errors: string[]
  effectGraphIds: string[]
  colorPipelineNodeIds: string[]
  audioGraphChannelIds: string[]
  extraAssetIds: string[]
}

export function isPassthroughEffectGraph(graph: HvsEffectGraph): boolean {
  const enabled = graph.nodes.filter(n => n.enabled !== false)
  return enabled.every(n => n.kind === 'MediaIn' || n.kind === 'MediaOut') && enabled.some(n => n.kind === 'MediaIn')
}

export function effectGraphBindsToAsset(graph: HvsEffectGraph, assetId: string): boolean {
  const ins = graph.nodes.filter(n => n.kind === 'MediaIn' && n.enabled !== false)
  const bg = ins.find(n => n.parameters.role === 'background') ?? ins[0]
  return Boolean(bg && bg.parameters.assetId === assetId)
}

export function isColorPipelineActive(pipeline: ColorPipeline): boolean {
  return pipeline.nodes.some(n => n.enabled)
}

export function isAudioGraphActive(graph: AudioGraph): boolean {
  if (graph.automation.length > 0) return true
  if (graph.buses.some(b => b.kind === 'submix' || b.inserts.some(i => i.enabled) || b.volume !== 1 || b.mute || b.pan !== 0)) return true
  return graph.channels.some(ch =>
    ch.inserts.some(i => i.enabled) || ch.volume !== 1 || ch.pan !== 0 || ch.mute || ch.solo,
  )
}

export function activeUnifiedLanes(project: HvsProject) {
  const graphs = (project.effectGraphs ?? []).filter(g => !isPassthroughEffectGraph(g))
  return {
    vfxActive: graphs.length > 0,
    colorActive: isColorPipelineActive(project.colorPipeline),
    audioActive: isAudioGraphActive(project.audioGraph),
    effectGraphIds: graphs.map(g => g.id),
    colorPipelineNodeIds: project.colorPipeline.nodes.filter(n => n.enabled).map(n => n.id),
    audioGraphChannelIds: project.audioGraph.channels.map(c => c.id),
    audioGraphBusIds: project.audioGraph.buses.map(b => b.id),
    versionId: project.currentVersionId,
    versionLabel: project.versions.find(v => v.id === project.currentVersionId)?.label ?? project.currentVersionId,
    aspect: project.timeline.aspect,
  }
}
