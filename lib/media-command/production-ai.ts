/**
 * HVS Director for prompt-first automated editing.
 * Natural language → ProductionIntent → ProductionPlan → (Commander approval) → typed EditOps.
 * Does not mutate a project until the Commander approves. Does not invent a second timeline.
 * Generation / publish / spend / upload / original deletion are out of scope.
 */
import { newCommandId, type EditCommand, type EditCommandActor } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import {
  cloneProject,
  findAsset,
  timelineDuration,
  type HvsProject,
} from './types'
import { DISSOLVE_KIND } from './transitions'
import { loadObservationsSync } from './video-analysis'
import { mayDeleteOriginal, mayPublishAutomatically, maySpendMoney } from './policy'
import { getStyleProfile, mergeStyleAudioGraph } from './production-style'
import {
  formatLabelForAspect,
  friendlyProductionError,
  lengthLabel,
  progressCopy,
  stepKindLabel,
} from './production-language'
import { runHvsSelector } from './production-selector'
import { videoClips } from './production-shots'
import { reframeMode } from './production-patches'
import { buildCaptionProposal, commandsForCaptionProposal } from './production-captions'
import { asrGateStatus, asrUnavailableCopy } from './asr-gate'
import type {
  HvsMomentCandidate,
  HvsNormalizedPromptContext,
  HvsProductionIntent,
  HvsProductionPlan,
  HvsProductionProgress,
  HvsProductionProgressStage,
  HvsProductionResult,
  HvsProductionStep,
  HvsProductionStepKind,
  HvsSelectorResult,
} from './production-ai-types'
import type { HvsPlanningConstraint } from './lessons/types'
import { constraintsDoNotEmitEditOps } from './lessons/retrieve'
import type { HvsCreativeApproach, HvsCreativeIntentAnalysis } from './creative-intelligence/types'

export { selectMoments, runHvsSelector } from './production-selector'
export { parseRevisionRequest, commandsForRevisionPatch } from './production-patches'
export { shotReferences } from './production-shots'

const ACTOR: EditCommandActor = 'ai-director'

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function cmd(partial: { kind: EditCommand['kind'] } & Record<string, unknown>): EditCommand {
  return {
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: ACTOR,
    ...partial,
  } as EditCommand
}

function step(
  kind: HvsProductionStepKind,
  system: HvsProductionStep['system'],
  extra?: Partial<HvsProductionStep>,
): HvsProductionStep {
  return {
    id: `step-${kind.toLowerCase()}`,
    kind,
    label: extra?.label ?? stepKindLabel(kind),
    detail: extra?.detail ?? stepKindLabel(kind),
    system,
    optional: extra?.optional ?? false,
    skippedReason: extra?.skippedReason ?? null,
  }
}

export function buildNormalizedPromptContext(project: HvsProject): HvsNormalizedPromptContext {
  const version = project.versions.find(v => v.id === project.currentVersionId)
  const cues = project.timeline.captionTracks.flatMap(track => track.cues)
  const observationCount = project.assets.reduce((sum, asset) => {
    const doc = loadObservationsSync(project.id, asset.id)
    return sum + (doc?.observationCount ?? 0)
  }, 0)
  const hasTranscript = project.assets.some(asset => {
    const doc = loadObservationsSync(project.id, asset.id)
    return Boolean(doc?.observations.some(row => row.transcript && row.transcript.trim()))
  }) || cues.some(cue => cue.text.trim())
  return {
    projectId: project.id,
    projectName: project.name,
    assetSummaries: project.assets.map(asset => ({
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      durationSec: toSeconds(asset.duration),
      width: asset.width,
      height: asset.height,
    })),
    clipCount: project.timeline.tracks.reduce((n, track) => n + track.clips.length, 0),
    timelineDurationSec: toSeconds(timelineDuration(project.timeline)),
    aspect: project.timeline.aspect,
    currentVersionLabel: version?.label ?? null,
    captionCueCount: cues.length,
    hasTranscript,
    observationCount,
    renderReady: project.renderJobs.some(job => job.status === 'completed' && Boolean(job.outputAssetId)),
  }
}

export function buildProductionPlan(
  project: HvsProject,
  intent: HvsProductionIntent,
  options?: {
    planningConstraints?: HvsPlanningConstraint[]
    creativeApproach?: HvsCreativeApproach | null
    creativeIntent?: HvsCreativeIntentAnalysis | null
    creativeAnalysisId?: string | null
  },
): HvsProductionPlan {
  const context = buildNormalizedPromptContext(project)
  const sourceIds = intent.sourceAssetIds.length
    ? intent.sourceAssetIds
    : project.assets.filter(asset => asset.kind === 'video' || asset.kind === 'image').map(asset => asset.id)
  const hasVideo = sourceIds.some(id => findAsset(project, id)?.kind === 'video' || findAsset(project, id)?.kind === 'image')
  const aspect = intent.aspect ?? project.timeline.aspect
  const duration = intent.durationSec ?? 15
  const style = getStyleProfile(intent.style)
  const wantsVariants = intent.constraints.includes('social-variants')
    || /three versions|tiktok, shorts, and instagram|tiktok and|vertical and square|versions for tiktok/i.test(intent.prompt)

  const analysisSteps = [
    step('ANALYZE_MEDIA', 'VideoIntelligence', {
      detail: hasVideo ? 'Look through the attached clips for usable moments.' : 'Add a video first.',
      optional: !hasVideo,
      skippedReason: hasVideo ? null : 'No video attached yet.',
    }),
    step('SELECT_MOMENTS', 'VideoIntelligence', {
      detail: 'Keep the strongest sections and skip empty space.',
    }),
  ]
  const storySteps = [
    step('TRIM_DEAD_SPACE', 'EditOps', { detail: 'Remove weak or empty sections.' }),
  ]
  const editSteps = [
    step('BUILD_ROUGH_CUT', 'EditOps', { detail: `Build about ${lengthLabel(duration)}.` }),
    step('APPLY_TRANSITIONS', 'EditOps', {
      detail: style.transitionKind === 'dissolve' ? 'Add smooth transitions.' : 'Keep clean cuts.',
      optional: style.transitionKind !== 'dissolve',
    }),
  ]
  const visualSteps = [
    step('APPLY_LOOK', 'ColorPipeline', { detail: `Use a ${style.label.toLowerCase()} look.` }),
  ]
  if (aspect === '9:16' || intent.platform === 'tiktok' || intent.platform === 'youtube-shorts') {
    visualSteps.push(step('CREATE_VARIANT', 'EditOps', {
      detail: 'Format for vertical video.',
      optional: false,
    }))
  }
  const audioSteps = [
    step('CLEAN_AUDIO', 'AudioGraph', { detail: 'Clean the sound.' }),
    step('BALANCE_AUDIO', 'AudioGraph', {
      detail: intent.music === 'louder' ? 'Make the music louder.' : 'Keep voice easy to hear.',
    }),
  ]
  const asr = asrGateStatus()
  const captionSkip = context.hasTranscript
    ? null
    : (asr.usableNow
      ? 'Captions need speech recognition before I can add them.'
      : asrUnavailableCopy(asr.status))
  const captionSteps = intent.captions
    ? [step('ADD_CAPTIONS', 'Captions', {
        detail: context.hasTranscript
          ? 'Add captions from the spoken words.'
          : 'Captions need speech recognition before I can add them.',
        optional: !context.hasTranscript,
        skippedReason: captionSkip,
      })]
    : []
  const deliverables: HvsProductionPlan['deliverables'] = [
    { aspect, label: formatLabelForAspect(aspect) },
  ]
  if (wantsVariants) {
    for (const item of [
      { aspect: '9:16' as const, label: 'Vertical' },
      { aspect: '1:1' as const, label: 'Square' },
      { aspect: '16:9' as const, label: 'Widescreen' },
    ]) {
      if (!deliverables.some(existing => existing.aspect === item.aspect)) deliverables.push(item)
    }
  }

  const allSteps = [...analysisSteps, ...storySteps, ...editSteps, ...visualSteps, ...audioSteps, ...captionSteps]
  allSteps.push(step('FINALIZE_VIDEO', 'UnifiedRenderEngine', { detail: 'Create the finished local video.' }))

  const planningConstraints = (options?.planningConstraints ?? []).filter(row => row.automaticEditOp === false)
  void constraintsDoNotEmitEditOps(planningConstraints)
  const creativeApproach = options?.creativeApproach ?? null
  const summaryLines = [
    'Find the strongest moments',
    `Build a ${lengthLabel(duration)} cut`,
    `Use a ${style.label.toLowerCase()} pace`,
    'Improve the picture',
    'Clean the sound',
    intent.captions ? 'Add captions if spoken words exist' : 'Keep the picture without new captions',
    aspect === '9:16' ? 'Format for vertical video' : `Keep ${formatLabelForAspect(aspect).toLowerCase()} framing`,
    'Create the final video on this computer',
    ...planningConstraints.map(row => `Consider: ${row.rule}`),
    ...(creativeApproach ? [
      `Creative approach: ${creativeApproach.title}`,
      `Creative concept: ${creativeApproach.concept}`,
    ] : []),
    ...(options?.creativeIntent?.typographyGoal ? [`Type: ${options.creativeIntent.typographyGoal}`] : []),
  ]

  return {
    id: id('plan'),
    intentId: intent.id,
    projectId: project.id,
    objective: intent.prompt.trim() || 'Make a short video from the attached clips.',
    summaryLines,
    lengthLabel: lengthLabel(duration),
    formatLabel: formatLabelForAspect(aspect),
    styleLabel: style.label,
    analysisSteps,
    storySteps,
    editSteps,
    visualSteps,
    audioSteps,
    captionSteps,
    deliverables,
    authorityRequirements: [
      { action: 'publish', allowed: false, reason: 'Publishing needs explicit Commander approval.' },
      { action: 'spend', allowed: false, reason: 'Spending money is not authorized.' },
      { action: 'upload', allowed: false, reason: 'External upload is not authorized.' },
      { action: 'delete_originals', allowed: false, reason: 'Original media stays immutable.' },
      { action: 'install_models', allowed: false, reason: 'This slice does not install models.' },
      { action: 'generate', allowed: false, reason: 'Prompt-to-film generation is a later capability.' },
    ],
    estimatedWork: {
      steps: allSteps.filter(item => !item.skippedReason).length,
      note: 'Prompt-driven automated editing of your media. Not generative filmmaking.',
    },
    explanation: {
      foundCount: 0,
      using: ['your strongest opening', 'the most active middle section', 'a cleaner closing shot'],
      leavingOut: ['long quiet sections', 'repeated footage'],
    },
    status: 'proposed',
    createdAt: new Date().toISOString(),
    planningConstraints,
    lessonConstraintCount: planningConstraints.length,
    automaticEditOp: false,
    creativeApproachId: creativeApproach?.id,
    creativeAnalysisId: options?.creativeAnalysisId ?? undefined,
  }
}

export function applySelectorExplanation(plan: HvsProductionPlan, selector: HvsSelectorResult): HvsProductionPlan {
  const created = selector.durationReport?.createdSec ?? selector.actualSec
  return {
    ...plan,
    explanation: {
      ...selector.explanation,
      leavingOut: selector.durationReport?.underfilled && selector.durationReport.underfillReason
        ? [...selector.explanation.leavingOut, selector.durationReport.underfillReason]
        : selector.explanation.leavingOut,
    },
    lengthLabel: lengthLabel(Math.round(created || selector.targetSec)),
  }
}

export function wantsVerticalVariant(intent: HvsProductionIntent, plan: HvsProductionPlan): boolean {
  return intent.aspect === '9:16'
    || intent.platform === 'tiktok'
    || intent.platform === 'youtube-shorts'
    || plan.deliverables.some(item => item.aspect === '9:16')
}

export type SelectedMoment = HvsMomentCandidate

export function commandsForApprovedPlan(
  project: HvsProject,
  intent: HvsProductionIntent,
  plan: HvsProductionPlan,
): { commands: EditCommand[]; skipped: Array<{ kind: HvsProductionStepKind; reason: string }>; moments: HvsMomentCandidate[]; selector: HvsSelectorResult } {
  const commands: EditCommand[] = []
  const skipped: Array<{ kind: HvsProductionStepKind; reason: string }> = []
  const ts = project.timeline.timescale
  const videoTrack = project.timeline.tracks.find(track => track.kind === 'video')
  const selector = runHvsSelector(project, intent)
  const moments = selector.selected
  const style = getStyleProfile(intent.style)
  const aspect = intent.aspect ?? plan.deliverables[0]?.aspect ?? project.timeline.aspect

  commands.push(cmd({
    kind: 'createVersion',
    versionLabel: 'Before AI produce',
    createdBy: 'ai-director',
    description: 'Safety snapshot before prompt-driven automated editing.',
  }))

  if (!videoTrack) {
    skipped.push({ kind: 'BUILD_ROUGH_CUT', reason: 'No video track.' })
    return { commands, skipped, moments, selector }
  }

  const existing = videoClips(project)
  for (const clip of [...existing].reverse()) {
    commands.push(cmd({ kind: 'rippleDelete', clipId: clip.id }))
  }

  if (!moments.length) {
    skipped.push({ kind: 'SELECT_MOMENTS', reason: 'Attach a video first.' })
    skipped.push({ kind: 'BUILD_ROUGH_CUT', reason: 'No usable sections yet.' })
  } else {
    for (const moment of moments) {
      const asset = findAsset(project, moment.assetId)
      if (!asset) continue
      const sourceIn = fromSeconds(moment.start, ts)
      const sourceOut = fromSeconds(Math.min(toSeconds(asset.duration), moment.end), ts)
      commands.push(cmd({
        kind: 'appendClip',
        trackId: videoTrack.id,
        assetId: asset.id,
        sourceIn,
        sourceOut,
        label: moment.role === 'open' ? 'Opening shot' : moment.role === 'close' ? 'Closing shot' : 'Selected moment',
      }))
    }
  }

  if (planHasStep(plan, 'APPLY_LOOK')) {
    commands.push(cmd({ kind: 'updateColorPipeline', pipeline: style.color }))
  }
  if (planHasStep(plan, 'CLEAN_AUDIO') || planHasStep(plan, 'BALANCE_AUDIO')) {
    commands.push(cmd({ kind: 'updateAudioGraph', graph: mergeStyleAudioGraph(project.audioGraph, style) }))
  }
  if (aspect === '9:16' && wantsVerticalVariant(intent, plan) && planHasStep(plan, 'CREATE_VARIANT') && plan.deliverables.length <= 1) {
    commands.push(cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: reframeMode(project) }))
    commands.push(cmd({ kind: 'deriveVerticalVersion', versionLabel: 'Vertical version' }))
  } else if (plan.deliverables.length > 1) {
    for (const item of plan.deliverables) {
      commands.push(cmd({ kind: 'autoReframe', outputAspect: item.aspect, mode: reframeMode(project) }))
    }
  }

  if (intent.captions) {
    const bundle = buildCaptionProposal(project, intent.prompt)
    const captionCommands = commandsForCaptionProposal(project, bundle)
    if (captionCommands.length) commands.push(...captionCommands)
    else skipped.push({
      kind: 'ADD_CAPTIONS',
      reason: bundle.skippedReason && /ASR_/.test(bundle.skippedReason)
        ? 'Captions need speech recognition before I can add them.'
        : (bundle.skippedReason ?? 'Captions need speech recognition before I can add them.'),
    })
  }

  return { commands, skipped, moments, selector }
}

export function planHasStep(plan: HvsProductionPlan, kind: HvsProductionStepKind): boolean {
  return allPlanSteps(plan).some(item => item.kind === kind && !item.skippedReason)
}

export function allPlanSteps(plan: HvsProductionPlan): HvsProductionStep[] {
  return [
    ...plan.analysisSteps,
    ...plan.storySteps,
    ...plan.editSteps,
    ...plan.visualSteps,
    ...plan.audioSteps,
    ...plan.captionSteps,
    step('FINALIZE_VIDEO', 'UnifiedRenderEngine'),
  ].filter((item, index, list) => list.findIndex(other => other.kind === item.kind) === index)
}

/**
 * Look/filter/transition commands that need clip ids after the cut exists.
 * Call on the project returned from the first commit, never on the pre-approval original.
 */
export function followUpCommandsAfterCut(
  project: HvsProject,
  intent: HvsProductionIntent,
  plan: HvsProductionPlan,
): EditCommand[] {
  const commands: EditCommand[] = []
  const videoTrack = project.timeline.tracks.find(track => track.kind === 'video')
  const clips = videoTrack?.clips ?? []
  const style = getStyleProfile(intent.style)
  const ts = project.timeline.timescale

  if (planHasStep(plan, 'APPLY_LOOK') && style.filterId) {
    for (const clip of clips) {
      commands.push(cmd({
        kind: 'applyFilter',
        clipId: clip.id,
        filterId: style.filterId,
        amount: style.filterAmount,
      }))
      if (intent.style === 'WARM') {
        commands.push(cmd({ kind: 'applyColor', clipId: clip.id, color: { temperature: 0.22 } }))
      }
      if (intent.style === 'COOL') {
        commands.push(cmd({ kind: 'applyColor', clipId: clip.id, color: { temperature: -0.22 } }))
      }
      if (intent.style === 'BRIGHT') {
        commands.push(cmd({ kind: 'applyColor', clipId: clip.id, color: { exposure: 0.12 } }))
      }
      if (intent.style === 'DARK' || intent.style === 'CINEMATIC') {
        commands.push(cmd({ kind: 'applyColor', clipId: clip.id, color: { contrast: 0.12, saturation: -0.05 } }))
      }
    }
  }

  if (style.transitionKind === 'dissolve' && clips.length >= 2 && planHasStep(plan, 'APPLY_TRANSITIONS')) {
    const joins = clips.length === 2 ? [0] : [0, clips.length - 2]
    for (const i of [...new Set(joins)]) {
      if (!clips[i + 1]) continue
      commands.push(cmd({
        kind: 'addTransition',
        outgoingClipId: clips[i].id,
        incomingClipId: clips[i + 1].id,
        transitionKind: DISSOLVE_KIND,
        duration: fromSeconds(0.35, ts),
      }))
    }
  }

  return commands
}

export function productionAuthorityOk(): { ok: true } | { ok: false; error: string } {
  if (mayPublishAutomatically()) return { ok: false, error: 'Automatic publish is not allowed.' }
  if (maySpendMoney()) return { ok: false, error: 'Spending money is not allowed in this slice.' }
  if (mayDeleteOriginal()) return { ok: false, error: 'Deleting originals is not allowed.' }
  return { ok: true }
}

export function commandsAreLocalOnly(commands: EditCommand[]): { ok: true } | { ok: false; error: string } {
  const forbidden = commands.find(command => (
    command.kind === 'generateVideo'
    || command.kind === 'generateImage'
    || ('action' in command && ['publish', 'spend', 'buy_credits', 'upload_business', 'delete_original'].includes(String((command as { action?: string }).action)))
  ))
  if (forbidden) return { ok: false, error: 'That action needs a separate Commander approval and is not part of AI Produce.' }
  return { ok: true }
}

export function withProgress(stage: HvsProductionProgressStage, extra?: Partial<HvsProductionProgress>): HvsProductionProgress {
  const copy = progressCopy(stage)
  return {
    stage,
    headline: extra?.headline ?? copy.headline,
    detail: extra?.detail ?? copy.detail,
    completed: extra?.completed ?? [],
    advancedDetail: extra?.advancedDetail ?? null,
    error: extra?.error ? friendlyProductionError(extra.error) : null,
    advancedError: extra?.advancedError ?? extra?.error ?? null,
  }
}

export function proveNoMutation(before: HvsProject, after: HvsProject): boolean {
  return JSON.stringify(cloneProject(before).timeline) === JSON.stringify(after.timeline)
    && before.currentVersionId === after.currentVersionId
    && before.colorPipeline.nodes.length === after.colorPipeline.nodes.length
    && before.audioGraph.channels.length === after.audioGraph.channels.length
}

export function previewAssetId(project: HvsProject): string | null {
  const rendered = [...project.renderJobs].reverse().find(job => job.status === 'completed' && job.outputAssetId)
  if (rendered?.outputAssetId) return rendered.outputAssetId
  const clip = project.timeline.tracks.find(track => track.kind === 'video')?.clips[0]
  if (clip) return clip.assetId
  return project.assets.find(asset => asset.kind === 'video' || asset.kind === 'image')?.id ?? null
}

export function buildProductionResult(
  project: HvsProject,
  plan: HvsProductionPlan,
  skipped: Array<{ kind: HvsProductionStepKind; reason: string }>,
  extra?: { durationReport?: HvsProductionResult['durationReport']; variants?: HvsProductionResult['variants'] },
): HvsProductionResult {
  const completed = allPlanSteps(plan)
    .map(item => item.kind)
    .filter(kind => !skipped.some(item => item.kind === kind))
  const lastRender = [...project.renderJobs].reverse().find(job => job.status === 'completed') ?? [...project.renderJobs].at(-1)
  const outputAsset = lastRender?.outputAssetId ? findAsset(project, lastRender.outputAssetId) : null
  const captionsAvailable = project.timeline.captionTracks.some(track => track.cues.length > 0)
    || project.assets.some(asset => Boolean(loadObservationsSync(project.id, asset.id)?.observations.some(row => row.transcript && row.transcript.trim())))
  return {
    projectId: project.id,
    planId: plan.id,
    versionId: project.currentVersionId,
    clipCount: videoClips(project).length,
    durationSec: toSeconds(timelineDuration(project.timeline)),
    aspect: project.timeline.aspect,
    previewAssetId: previewAssetId(project),
    renderJobId: lastRender?.id ?? null,
    renderOutputAssetId: lastRender?.outputAssetId ?? null,
    completedSteps: completed,
    skippedSteps: skipped,
    captionsAvailable,
    outputPath: outputAsset?.originalPath ?? null,
    variantVersionIds: project.versions.filter(version => version.role === 'derived').map(version => version.id),
    durationReport: extra?.durationReport ?? null,
    variants: extra?.variants ?? [],
  }
}
