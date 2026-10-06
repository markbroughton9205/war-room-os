/**
 * Honest cross-lane deliver seam.
 * Do not claim a flattened sequential job is unified RenderEngine consumption.
 */
export const UNIFIED_RENDER_SEAM = {
  renderEngineConsumesEffectGraph: true,
  renderEngineConsumesColorPipeline: true,
  renderEngineConsumesAudioGraph: true,
  timelineRenderStillWorks: true,
  sequentialLaneJobs: ['executeEffectGraph', 'executeColorPipeline', 'executeAudioGraph'] as const,
  missingIntegration: null,
  note: 'Wave 6: processRenderQueue/renderTimeline compiles EffectGraph + ColorPipeline + AudioGraph into one FFmpeg graph. Sequential lane jobs remain for Program/lane stills and are not Final Deliver.',
} as const
