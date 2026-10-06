/**
 * Natural-language revision → ProductionPlanPatch → typed EditOps.
 * Revisions are relative to the current production. They do not rebuild blindly.
 */
import { newCommandId, type EditCommand, type EditCommandActor } from './edit-commands'
import { fromSeconds, toSeconds } from './time'
import { findAsset, timelineDuration, type HvsProject, type OutputAspect } from './types'
import { getStyleProfile, mergeStyleAudioGraph } from './production-style'
import { stepKindLabel } from './production-language'
import { describeShot, parseShotMention, shotReferences, videoClips } from './production-shots'
import { runHvsSelector } from './production-selector'
import { buildCaptionProposal, commandsForCaptionProposal } from './production-captions'
import { parseRequestedVariantAspects, commandsForVariants } from './production-variants'
import type {
  HvsProductionPlanPatch,
  HvsProductionPlanPatchKind,
  HvsProductionStep,
  HvsProductionStepKind,
  HvsRevisionRequest,
  HvsShotReference,
} from './production-ai-types'

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

export function reframeMode(project: HvsProject): 'CINEMATIC_FOLLOW' | 'RULE_OF_THIRDS' {
  return project.timeline.subjects.length ? 'CINEMATIC_FOLLOW' : 'RULE_OF_THIRDS'
}

function durationFromUtterance(lower: string): number | null {
  const match = lower.match(/(\d+)\s*(?:-)?\s*seconds?/)
  return match ? Number(match[1]) : null
}

export function parseRevisionRequest(input: {
  projectId: string
  planId: string
  utterance: string
  project?: HvsProject
}): { request: HvsRevisionRequest; patch: HvsProductionPlanPatch } {
  const utterance = input.utterance.trim()
  const lower = utterance.toLowerCase()
  const refs = input.project ? shotReferences(input.project) : []
  const shotRef = parseShotMention(utterance, refs)
  const steps: HvsProductionStep[] = []
  const commandKinds: Array<EditCommand['kind']> = []
  const notes: string[] = []
  let kind: HvsProductionPlanPatchKind = 'SHORTEN_SHOT'
  let durationSec: number | null = null
  let aspect: OutputAspect | null = null

  if (/stronger opening|different opening|better opening|use a stronger/.test(lower) || (/opening/.test(lower) && /use the part|walks into frame|strongest/.test(lower))) {
    kind = 'CHANGE_OPENING'
    steps.push(step('SELECT_MOMENTS', 'VideoIntelligence', { detail: 'Use a stronger opening.' }))
    commandKinds.push('slipClip')
    notes.push(`Use a stronger ${describeShot(shotRef ?? refs[0], 'opening shot')}.`)
  } else if (/ending slower|slower ending|slow the (end|close|closing)/.test(lower)) {
    kind = 'CHANGE_ENDING'
    steps.push(step('BUILD_ROUGH_CUT', 'EditOps', { detail: 'Make the ending slower.' }))
    commandKinds.push('setSpeed')
    notes.push(`Slow down the ${describeShot(shotRef ?? refs.at(-1) ?? null, 'closing shot')}.`)
  } else if (/different ending|stronger ending|change the ending|closing shot/.test(lower) && /shorter|longer/.test(lower) === false) {
    kind = 'CHANGE_ENDING'
    steps.push(step('SELECT_MOMENTS', 'VideoIntelligence', { detail: 'Use a clearer ending.' }))
    commandKinds.push('slipClip')
    notes.push(`Change the ${describeShot(shotRef ?? refs.at(-1) ?? null, 'closing shot')}.`)
  } else if (/take .* out|remove that|remove this|cut that|remove the .* (clip|shot|scene)/.test(lower)) {
    kind = 'REMOVE_SHOT'
    steps.push(step('TRIM_DEAD_SPACE', 'EditOps', { detail: `Take out the ${describeShot(shotRef, 'selected shot')}.` }))
    commandKinds.push('rippleDelete')
    notes.push(`Remove the ${describeShot(shotRef, 'selected shot')}.`)
  } else if (/move |put .* first|use .* first|opening shot should/.test(lower) && /stronger/.test(lower) === false) {
    kind = 'MOVE_SHOT'
    steps.push(step('BUILD_ROUGH_CUT', 'EditOps', { detail: 'Move a shot.' }))
    commandKinds.push('moveClip')
    notes.push(`Move the ${describeShot(shotRef, 'selected shot')}.`)
  } else if (/whole thing|make it \d+|make the whole|target .* second/.test(lower) || (/\d+\s*seconds?/.test(lower) && /shot|clip|opening|ending/.test(lower) === false)) {
    kind = 'CHANGE_DURATION'
    durationSec = durationFromUtterance(lower)
    steps.push(step('BUILD_ROUGH_CUT', 'EditOps', { detail: durationSec ? `Aim for about ${durationSec} seconds.` : 'Change the length.' }))
    commandKinds.push('rippleDelete', 'appendClip')
    notes.push(durationSec ? `Rebuild the cut to about ${durationSec} seconds from selected moments.` : 'Change the running time.')
  } else if (/shorter|less time|trim/.test(lower)) {
    kind = 'SHORTEN_SHOT'
    steps.push(step('TRIM_DEAD_SPACE', 'EditOps', { detail: `Shorten the ${describeShot(shotRef, 'shot')}.` }))
    commandKinds.push('rippleTrim')
    notes.push(`Shorten the ${describeShot(shotRef ?? refs.at(-1) ?? null, 'shot')}.`)
  } else if (/longer|extend|hold .* longer/.test(lower)) {
    kind = 'EXTEND_SHOT'
    steps.push(step('BUILD_ROUGH_CUT', 'EditOps', { detail: `Hold the ${describeShot(shotRef, 'shot')} longer.` }))
    commandKinds.push('rippleTrim')
    notes.push(`Hold the ${describeShot(shotRef ?? refs.at(-1) ?? null, 'shot')} longer if source remains.`)
  } else if (/replace|use the part where|walks into frame/.test(lower)) {
    kind = 'REPLACE_SHOT'
    steps.push(step('SELECT_MOMENTS', 'VideoIntelligence', { detail: 'Use a different moment from the same clip.' }))
    commandKinds.push('slipClip')
    notes.push(`Replace the ${describeShot(shotRef ?? refs[0], 'shot')} with a stronger moment from the same footage.`)
  } else if (/warm/.test(lower)) {
    kind = 'CHANGE_LOOK'
    steps.push(step('APPLY_LOOK', 'ColorPipeline', { detail: 'Make the colors warmer.' }))
    commandKinds.push('applyColor', 'updateColorPipeline')
    notes.push('Warm the look.')
  } else if (/cool|colder|cold/.test(lower)) {
    kind = 'CHANGE_LOOK'
    steps.push(step('APPLY_LOOK', 'ColorPipeline', { detail: 'Make the colors cooler.' }))
    commandKinds.push('applyColor', 'updateColorPipeline')
    notes.push('Cool the look.')
  } else if (/cinematic|darker|brighter|clean look/.test(lower)) {
    kind = 'CHANGE_LOOK'
    steps.push(step('APPLY_LOOK', 'ColorPipeline', { detail: 'Change the look.' }))
    commandKinds.push('updateColorPipeline')
    notes.push('Change the picture look.')
  } else if (/music (down|quieter|softer)|turn the music|volume down/.test(lower)) {
    kind = 'CHANGE_AUDIO'
    steps.push(step('BALANCE_AUDIO', 'AudioGraph', { detail: 'Turn the music down.' }))
    commandKinds.push('setVolume')
    notes.push('Lower the music.')
  } else if (/music louder/.test(lower)) {
    kind = 'CHANGE_AUDIO'
    steps.push(step('BALANCE_AUDIO', 'AudioGraph', { detail: 'Make the music louder.' }))
    commandKinds.push('setVolume')
    notes.push('Raise music volume.')
  } else if (/voice clearer|dialogue|noise|clean(ed)? the sound/.test(lower)) {
    kind = 'CHANGE_AUDIO'
    steps.push(step('CLEAN_AUDIO', 'AudioGraph', { detail: 'Clean the sound.' }))
    commandKinds.push('updateAudioGraph')
    notes.push('Clean the voice.')
  } else if (/add captions?|captions? from transcript|put captions/.test(lower)) {
    kind = 'CHANGE_CAPTIONS'
    steps.push(step('ADD_CAPTIONS', 'Captions', { detail: 'Add captions from the spoken words.' }))
    commandKinds.push('addCaption')
    notes.push('Add captions if a transcript exists. I will not invent words.')
  } else if (/caption.*big|bigger caption|captions bigger/.test(lower)) {
    kind = 'CHANGE_CAPTIONS'
    steps.push(step('ADD_CAPTIONS', 'Captions', { detail: 'Make the captions bigger.' }))
    commandKinds.push('updateCaption')
    notes.push('Increase caption size.')
  } else if ((/widescreen|16\s*[:x]\s*9|landscape/.test(lower) && /vertical/.test(lower) && /square/.test(lower)) || /versions for tiktok, youtube shorts, and youtube|widescreen, vertical, and square/.test(lower)) {
    kind = 'CHANGE_ASPECT'
    aspect = '16:9'
    steps.push(step('CREATE_VARIANT', 'EditOps', { detail: 'Make widescreen, vertical, and square versions from this project.' }))
    commandKinds.push('autoReframe', 'render')
    notes.push('Create widescreen, vertical, and square versions from the same media. Originals stay in place.')
  } else if (/vertical and square|square and vertical|vertical.*square|tiktok and youtube|youtube shorts/.test(lower) || (/square/.test(lower) && /vertical/.test(lower))) {
    kind = 'CHANGE_ASPECT'
    aspect = '9:16'
    steps.push(step('CREATE_VARIANT', 'EditOps', { detail: 'Make vertical and square versions from this project.' }))
    commandKinds.push('autoReframe', 'render')
    notes.push('Create vertical and square versions from the same media. Originals stay in place.')
  } else if (/square|1:1/.test(lower) && /vertical/.test(lower) === false) {
    kind = 'CHANGE_ASPECT'
    aspect = '1:1'
    steps.push(step('CREATE_VARIANT', 'EditOps', { detail: 'Make a square version from this project.' }))
    commandKinds.push('autoReframe', 'render')
    notes.push('Create a square version from the same media. Originals stay in place.')
  } else if (/vertical|tiktok|9:16|youtube shorts/.test(lower)) {
    kind = 'CHANGE_ASPECT'
    aspect = '9:16'
    steps.push(step('CREATE_VARIANT', 'EditOps', { detail: 'Make a vertical version from this project.' }))
    commandKinds.push('autoReframe', 'deriveVerticalVersion')
    notes.push('Create a vertical version from the same media. Originals stay in place.')
  } else if (/youtube/.test(lower) && /vertical/.test(lower) === false) {
    kind = 'CHANGE_ASPECT'
    aspect = '16:9'
    steps.push(step('CREATE_VARIANT', 'EditOps', { detail: 'Keep a landscape YouTube version.' }))
    notes.push('Keep the landscape version of this project.')
  }

  if (!steps.length) {
    kind = 'SHORTEN_SHOT'
    steps.push(step('BUILD_ROUGH_CUT', 'EditOps', {
      detail: 'I understood a change request, but need a clearer instruction.',
      optional: true,
    }))
    notes.push('No typed edit matched yet. Try: make the opening shorter, take shot 2 out, make it warmer, make a vertical version.')
  }

  const request: HvsRevisionRequest = {
    id: id('rev'),
    projectId: input.projectId,
    planId: input.planId,
    utterance,
    createdAt: new Date().toISOString(),
    status: 'proposed',
  }
  const patch: HvsProductionPlanPatch = {
    id: id('patch'),
    revisionId: request.id,
    kind,
    summary: notes.join(' '),
    steps,
    commandKinds,
    shotRef,
    durationSec,
    aspect,
  }
  return { request, patch }
}

function resolveClip(project: HvsProject, shotRef: HvsShotReference | null, fallback: 'first' | 'last' = 'last') {
  const clips = videoClips(project)
  if (shotRef?.clipId) return clips.find(clip => clip.id === shotRef.clipId) ?? clips[shotRef.index] ?? null
  if (fallback === 'first') return clips[0] ?? null
  return clips.at(-1) ?? null
}

export function commandsForRevisionPatch(
  project: HvsProject,
  patch: HvsProductionPlanPatch,
  utterance: string,
  intentDurationSec?: number | null,
): EditCommand[] {
  const commands: EditCommand[] = []
  const lower = utterance.toLowerCase()
  const ts = project.timeline.timescale
  const clips = videoClips(project)
  const shot = resolveClip(
    project,
    patch.shotRef,
    patch.kind === 'CHANGE_OPENING' || patch.kind === 'REPLACE_SHOT' ? 'first' : 'last',
  )
  const music = project.timeline.tracks.find(track => /music/i.test(track.name) || track.id === 'A2')

  if (patch.kind === 'SHORTEN_SHOT' && shot) {
    const currentEnd = shot.start.ticks + shot.duration.ticks
    const delta = Math.round(-1.5 * ts)
    const toTicks = Math.max(shot.start.ticks + Math.round(0.4 * ts), currentEnd + delta)
    commands.push(cmd({ kind: 'rippleTrim', clipId: shot.id, edge: 'out', to: { ticks: toTicks, timescale: ts } }))
  }
  if (patch.kind === 'EXTEND_SHOT' && shot) {
    const currentEnd = shot.start.ticks + shot.duration.ticks
    const asset = findAsset(project, shot.assetId)
    const sourceRemain = asset ? Math.max(0, toSeconds(asset.duration) - toSeconds(shot.sourceOut)) : 1.2
    const add = Math.min(1.2, sourceRemain)
    commands.push(cmd({
      kind: 'rippleTrim',
      clipId: shot.id,
      edge: 'out',
      to: { ticks: currentEnd + Math.round(add * ts), timescale: ts },
    }))
  }
  if ((patch.kind === 'CHANGE_OPENING' || patch.kind === 'REPLACE_SHOT') && shot) {
    commands.push(cmd({ kind: 'slipClip', clipId: shot.id, delta: fromSeconds(0.8, ts) }))
  }
  if (patch.kind === 'CHANGE_ENDING' && shot) {
    if (patch.commandKinds.includes('setSpeed')) {
      commands.push(cmd({ kind: 'setSpeed', clipId: shot.id, speed: { n: 3, d: 4 } }))
    } else {
      commands.push(cmd({ kind: 'slipClip', clipId: shot.id, delta: fromSeconds(0.5, ts) }))
    }
  }
  if (patch.kind === 'REMOVE_SHOT' && shot && clips.length > 1) {
    commands.push(cmd({ kind: 'rippleDelete', clipId: shot.id }))
  }
  if (patch.kind === 'MOVE_SHOT' && shot) {
    commands.push(cmd({ kind: 'moveClip', clipId: shot.id, trackId: 'V1', start: fromSeconds(0, ts) }))
  }
  if (patch.kind === 'CHANGE_LOOK') {
    const warmer = /warm/.test(lower)
    const cooler = /cool|cold/.test(lower)
    const temp = warmer ? 0.22 : cooler ? -0.22 : 0
    if (shot && (warmer || cooler)) {
      commands.push(cmd({ kind: 'applyColor', clipId: shot.id, color: { temperature: temp } }))
    }
    commands.push(cmd({
      kind: 'updateColorPipeline',
      pipeline: warmer
        ? getStyleProfile('WARM').color
        : cooler
          ? getStyleProfile('COOL').color
          : /cinematic/.test(lower)
            ? getStyleProfile('CINEMATIC').color
            : /dark/.test(lower)
              ? getStyleProfile('DARK').color
              : getStyleProfile('BRIGHT').color,
    }))
  }
  if (patch.kind === 'CHANGE_AUDIO') {
    if (patch.commandKinds.includes('setVolume')) {
      const down = /down|quiet|soft/.test(lower)
      const musicClip = music?.clips[0]
      if (musicClip) commands.push(cmd({ kind: 'setVolume', clipId: musicClip.id, volume: down ? 0.55 : 1.25 }))
      else if (shot) commands.push(cmd({ kind: 'setVolume', clipId: shot.id, volume: down ? 0.7 : 1.15 }))
    }
    if (patch.commandKinds.includes('updateAudioGraph')) {
      commands.push(cmd({
        kind: 'updateAudioGraph',
        graph: mergeStyleAudioGraph(project.audioGraph, getStyleProfile('CLEAN')),
      }))
    }
  }
  if (patch.kind === 'CHANGE_CAPTIONS') {
    if (patch.commandKinds.includes('addCaption')) {
      const bundle = buildCaptionProposal(project, utterance)
      commands.push(...commandsForCaptionProposal(project, bundle))
    } else {
      const cue = project.timeline.captionTracks[0]?.cues[0]
      if (cue) commands.push(cmd({ kind: 'updateCaption', cueId: cue.id, fontSize: Math.min(64, (cue.fontSize ?? 38) + 10) }))
    }
  }
  if (patch.kind === 'CHANGE_ASPECT') {
    const requested = parseRequestedVariantAspects(utterance)
    const aspects = requested.length ? requested : [patch.aspect ?? '9:16']
    if (aspects.length === 1 && aspects[0] === '9:16') {
      commands.push(cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: reframeMode(project) }))
      commands.push(cmd({ kind: 'deriveVerticalVersion', versionLabel: 'Vertical version' }))
    } else {
      commands.push(...commandsForVariants(project, aspects.map(aspect => ({
        id: `var-${aspect}`,
        name: aspect === '9:16' ? 'Vertical' : aspect === '1:1' ? 'Square' : 'Widescreen',
        aspect,
        targetDuration: null,
        platformIntent: null,
        reframeMode: reframeMode(project),
        captionStyle: null,
        outputSpec: aspect === '9:16'
          ? { aspect, width: 1080, height: 1920, format: 'mp4' as const }
          : aspect === '1:1'
            ? { aspect, width: 1080, height: 1080, format: 'mp4' as const }
            : { aspect: '16:9' as const, width: 1920, height: 1080, format: 'mp4' as const },
        derivedFromVersionId: project.currentVersionId,
        status: 'planned' as const,
        renderJobId: null,
        outputAssetId: null,
        outputPath: null,
      }))))
    }
  }
  if (patch.kind === 'CHANGE_DURATION') {
    const target = patch.durationSec ?? durationFromUtterance(lower) ?? intentDurationSec ?? 20
    const selector = runHvsSelector(project, {
      id: 'rev-duration',
      projectId: project.id,
      prompt: `Make it ${target} seconds.`,
      sourceAssetIds: [],
      goal: 'SHORT_FROM_CLIPS',
      durationSec: target,
      aspect: project.timeline.aspect,
      style: null,
      tone: null,
      platform: null,
      captions: false,
      music: 'keep',
      voice: 'keep',
      constraints: ['prefer-strong-moments'],
      createdAt: new Date().toISOString(),
    })
    for (const clip of [...clips].reverse()) {
      commands.push(cmd({ kind: 'rippleDelete', clipId: clip.id }))
    }
    const videoTrack = project.timeline.tracks.find(track => track.kind === 'video')
    if (videoTrack) {
      for (const moment of selector.selected) {
        const asset = findAsset(project, moment.assetId)
        if (!asset) continue
        commands.push(cmd({
          kind: 'appendClip',
          trackId: videoTrack.id,
          assetId: asset.id,
          sourceIn: fromSeconds(moment.start, ts),
          sourceOut: fromSeconds(Math.min(toSeconds(asset.duration), moment.end), ts),
          label: moment.role === 'open' ? 'Opening shot' : moment.role === 'close' ? 'Closing shot' : 'Selected moment',
        }))
      }
    }
  }

  void timelineDuration
  return commands
}
