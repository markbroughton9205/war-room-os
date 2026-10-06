/**
 * AI Director: natural-language production commands → structured EditOps.
 * Not tips. Not UI clicking. Operates against the live working timeline.
 */
import { fromSeconds } from './director-helpers'
import type { EditCommand, EditCommandActor, SetVirtualCameraCommand } from './edit-commands'
import { newCommandId } from './edit-commands'
import { LUXURY_BEAUTY_V1_ID } from './themes'
import { clipAtPlayhead } from './edit-ops'
import { pairForPlayhead } from './transitions'
import type { HvsProductionPageId } from './production-pages'
import type { HvsProject } from './types'
import { timelineDuration } from './types'
import { findVersionByLabel } from './versions'
import { toSeconds, type MediaTime } from './time'
import { highestMotionHit, loadObservationsSync, searchPersistedObservations } from './video-analysis'
import { firstBlurGraph, firstChromaKeyGraph, firstTrackedBackgroundBlurGraph } from './effect-graph'
import { WAVE9_ASR_RECOMMENDATION } from './wave9-runtime-audit'
import { asrGateStatus } from './asr-gate'
import { readTranscriptSync, searchTranscript, proposeCaptionsFromTranscript } from './transcript'
import { searchObjectObservations } from './object-intelligence'
import { ACTION_RECOGNITION_STATUS } from './action-intelligence'
import { embeddingsUsableNow } from './embeddings'
import { parseGenerateVideoUtterance } from './generative/director'
import type { HvsGenerateVideoOp } from './generative/types'

export type DirectorMode = 'MANUAL' | 'AI_ASSIST' | 'AI_SUGGEST' | 'AI_FIRST_CUT' | 'AI_DIRECTOR' | 'AUTOMATIC_DRAFT'

export type SourceMonitorAction = {
  kind: 'markIn' | 'markOut' | 'clearIn' | 'clearOut' | 'seek' | 'selectAsset'
  time?: MediaTime
  assetId?: string
}

export type DirectorContext = {
  playheadSeconds?: number
  selectedClipId?: string
  selectedCueId?: string
  selectedOverlayId?: string
  followMode?: SetVirtualCameraCommand['mode']
  sourceAssetId?: string
  sourceIn?: MediaTime | null
  sourceOut?: MediaTime | null
  sourcePlayheadSeconds?: number
  workspacePage?: HvsProductionPageId
}

export type DirectorProposal = {
  id: string
  mode: DirectorMode
  utterance: string
  commands: EditCommand[]
  sourceActions?: SourceMonitorAction[]
  summary: string
  requiresNewVersion: boolean
  requiresConfirmation?: boolean
  openVersionBrowser?: boolean
  compareVersionIds?: [string, string]
  requiresSpendApproval?: boolean
    lane?: 'edit' | 'provider' | 'analysis' | 'vfx' | 'color' | 'audio' | 'deliver' | 'review'
    jobProposal?: {
    kind: 'provider' | 'analysis' | 'vfx' | 'color' | 'audio' | 'render' | 'qc'
    capability?: string
    status: 'proposal' | 'BLOCKED_PENDING_APPROVAL' | 'NOT_AVAILABLE' | 'INSTALL_APPROVAL_REQUIRED'
    execute: false
  }
  sourceSeek?: { assetId: string; time: MediaTime; reason: string } | null
  /** HVS-GENERATIVE-VIDEO-01: typed local generation proposals (`hvs.generate.video`). Never executed by the Director. */
  generativeOps?: HvsGenerateVideoOp[]
}

function cmd(partial: { kind: EditCommand['kind']; actor?: EditCommandActor } & Record<string, unknown>): EditCommand {
  return {
    id: newCommandId(),
    createdAt: new Date().toISOString(),
    actor: partial.actor ?? 'ai-director',
    ...partial,
  } as EditCommand
}

function firstVideoClip(project: HvsProject) {
  return project.timeline.tracks.find(t => t.kind === 'video')?.clips[0] ?? null
}

function resolveClip(project: HvsProject, context?: DirectorContext) {
  if (context?.selectedClipId) {
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find(c => c.id === context.selectedClipId)
      if (clip) return clip
    }
  }
  if (context?.playheadSeconds != null) {
    const atPlayhead = clipAtPlayhead(project, {
      ticks: Math.round(context.playheadSeconds * project.timeline.timescale),
      timescale: project.timeline.timescale,
    })
    if (atPlayhead) return atPlayhead
  }
  return firstVideoClip(project)
}

export function proposeDirectorCommands(
  project: HvsProject,
  utterance: string,
  mode: DirectorMode = 'AI_DIRECTOR',
  context: DirectorContext = {},
): DirectorProposal {
  const text = utterance.trim()
  const lower = text.toLowerCase()
  const commands: EditCommand[] = []
  const clip = resolveClip(project, context)
  const logo = project.assets.find(a => a.kind === 'logo') ?? project.assets.find(a => /logo|higher vision/i.test(a.name))
  const dur = timelineDuration(project.timeline)
  const playhead = context.playheadSeconds ?? 0
  const ts = project.timeline.timescale
  let requiresNewVersion = mode === 'AI_FIRST_CUT' || mode === 'AUTOMATIC_DRAFT'
  let requiresConfirmation = false
  let requiresSpendApproval = false
  let lane: DirectorProposal['lane'] = 'edit'
  let jobProposal: DirectorProposal['jobProposal']
  let openVersionBrowser = false
  let compareVersionIds: [string, string] | undefined
  const notes: string[] = []
  const sourceActions: SourceMonitorAction[] = []
  let sourceSeek: DirectorProposal['sourceSeek'] = null

  if (/mark in( here)?|set (source )?in/i.test(lower) && /out/.test(lower) === false) {
    sourceActions.push({ kind: 'markIn' })
    notes.push('Mark Source In at the Source Monitor playhead. Session state only — not an EditOp.')
  }
  if (/mark out( here)?|set (source )?out/i.test(lower)) {
    sourceActions.push({ kind: 'markOut' })
    notes.push('Mark Source Out at the Source Monitor playhead. Session state only — not an EditOp.')
  }
  if (/clear in/i.test(lower)) {
    sourceActions.push({ kind: 'clearIn' })
    notes.push('Clear Source In. Session state only.')
  }
  if (/clear out/i.test(lower)) {
    sourceActions.push({ kind: 'clearOut' })
    notes.push('Clear Source Out. Session state only.')
  }
  if (/use this section|insert (this |the )?(range|selection)|insert from source/i.test(lower)) {
    const assetId = context.sourceAssetId
    const inn = context.sourceIn
    const out = context.sourceOut
    const track = project.timeline.tracks.find(t => t.kind === 'video')
    if (assetId && inn && out && track) {
      commands.push(cmd({
        kind: 'insertClip',
        trackId: track.id,
        assetId,
        start: { ticks: Math.round(playhead * ts), timescale: ts },
        sourceIn: inn,
        sourceOut: out,
        label: 'Insert source range',
      }))
      notes.push('Insert the Source Monitor In/Out range via insertClip.')
    } else {
      notes.push('Insert from source needs a selected asset and In/Out marks.')
    }
  }
  if (/overwrite (this |the )?(range|selection)|overwrite from source/i.test(lower)) {
    const assetId = context.sourceAssetId
    const inn = context.sourceIn
    const out = context.sourceOut
    const track = project.timeline.tracks.find(t => t.kind === 'video')
    if (assetId && inn && out && track) {
      commands.push(cmd({
        kind: 'overwriteClip',
        trackId: track.id,
        assetId,
        start: { ticks: Math.round(playhead * ts), timescale: ts },
        sourceIn: inn,
        sourceOut: out,
        duration: { ticks: out.ticks - inn.ticks, timescale: out.timescale },
        label: 'Overwrite source range',
      }))
      notes.push('Overwrite the Source Monitor In/Out range via overwriteClip.')
    } else {
      notes.push('Overwrite from source needs a selected asset and In/Out marks.')
    }
  }
  if (/append (this |the )?(range|selection)|append from source/i.test(lower)) {
    const assetId = context.sourceAssetId
    const inn = context.sourceIn
    const out = context.sourceOut
    const track = project.timeline.tracks.find(t => t.kind === 'video')
    if (assetId && inn && out && track) {
      commands.push(cmd({
        kind: 'appendClip',
        trackId: track.id,
        assetId,
        sourceIn: inn,
        sourceOut: out,
        label: 'Append source range',
      }))
      notes.push('Append the Source Monitor In/Out range via appendClip.')
    }
  }
  if (/half speed|0\.5x|play this at half|slow (this|it) down/i.test(lower)) {
    if (clip) commands.push(cmd({ kind: 'setSpeed', clipId: clip.id, speed: { n: 1, d: 2 }, label: 'Half speed' }))
    notes.push('Set clip speed to 0.5x. Timeline duration scales; audio uses atempo on render.')
  }
  if (/\b2x\b|double speed|twice as fast|play this at 2/i.test(lower)) {
    if (clip) commands.push(cmd({ kind: 'setSpeed', clipId: clip.id, speed: { n: 2, d: 1 }, label: 'Double speed' }))
    notes.push('Set clip speed to 2.0x. Timeline duration scales; audio uses atempo on render.')
  }
  if (/reverse this( clip)?/i.test(lower)) {
    if (clip) commands.push(cmd({ kind: 'reverseClip', clipId: clip.id, reversed: true, label: 'Reverse clip' }))
    notes.push('Reverse the targeted clip non-destructively.')
  }
  if (/freeze this frame|freeze frame/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'createFreezeFrame',
        clipId: clip.id,
        at: clip.sourceIn,
        duration: fromSeconds(2, ts),
        start: { ticks: Math.round(playhead * ts), timescale: ts },
        label: 'Create freeze frame',
      }))
      notes.push('Create a freeze-frame clip from the current source frame.')
    }
  }
  const selectedCue = project.timeline.captionTracks[0]?.cues.find(c => c.id === context.selectedCueId)
    ?? project.timeline.captionTracks[0]?.cues[0]
    ?? null
  const selectedOverlay = project.timeline.overlays.find(o => o.id === context.selectedOverlayId)
    ?? project.timeline.overlays.find(o => o.kind === 'title')
    ?? null
  const titleMatch = /add a title that says\s+(.+)/i.exec(text)
  if (titleMatch) {
    commands.push(cmd({
      kind: 'addTitle',
      text: titleMatch[1].replace(/[.]+$/, '').trim(),
      start: { ticks: Math.round(playhead * ts), timescale: ts },
      duration: fromSeconds(3, ts),
      stylePreset: 'cinematic',
      label: 'Add title',
    }))
    notes.push('Add a title overlay from the uttered text.')
  } else if (/add a title|coming soon/i.test(lower) && !/cinematic title/i.test(lower)) {
    commands.push(cmd({
      kind: 'addTitle',
      text: /coming soon/i.test(lower) ? 'Coming Soon' : 'HIGHER VISION',
      start: { ticks: Math.round(playhead * ts), timescale: ts },
      duration: fromSeconds(3, ts),
      stylePreset: 'cinematic',
      label: 'Add title',
    }))
    notes.push('Add a cinematic title.')
  }
  if (/put this caption at the top|caption at the top|move (the )?captions? (to the )?top/i.test(lower)) {
    if (selectedCue) {
      commands.push(cmd({ kind: 'updateCaption', cueId: selectedCue.id, positionPreset: 'top-center', label: 'Caption top' }))
      notes.push('Move the selected caption to TOP CENTER via updateCaption.')
    }
  }
  if (/make the captions larger|captions larger|bigger caption/i.test(lower)) {
    if (selectedCue) {
      commands.push(cmd({ kind: 'updateCaption', cueId: selectedCue.id, fontSize: Math.round((selectedCue.fontSize ?? 38) * 1.25), label: 'Caption larger' }))
      notes.push('Increase caption font size via updateCaption.')
    }
  }
  if (/cinematic title|use the cinematic/i.test(lower)) {
    if (selectedOverlay?.kind === 'title') {
      commands.push(cmd({ kind: 'setTitleStyle', overlayId: selectedOverlay.id, stylePreset: 'cinematic', label: 'Cinematic title' }))
      notes.push('Apply CINEMATIC TITLE preset via setTitleStyle.')
    } else if (!commands.some(c => c.kind === 'addTitle')) {
      commands.push(cmd({
        kind: 'addTitle',
        text: 'HIGHER VISION',
        start: { ticks: Math.round(playhead * ts), timescale: ts },
        duration: fromSeconds(3, ts),
        stylePreset: 'cinematic',
      }))
      notes.push('Add a cinematic title preset.')
    }
  }
  if (/add a lower third|lower third/i.test(lower)) {
    commands.push(cmd({
      kind: 'addLowerThird',
      text: 'HIGHER VISION',
      secondaryText: 'Studios',
      start: { ticks: Math.round(playhead * ts), timescale: ts },
      duration: fromSeconds(4, ts),
      label: 'Lower third',
    }))
    notes.push('Add a static lower-third title. No motion-graphics engine.')
  }
  if (/pan this left|pan (the |this )?(audio |clip )?left|pan left/i.test(lower) && clip) {
    commands.push(cmd({ kind: 'setPan', clipId: clip.id, pan: -1, label: 'Pan left' }))
    notes.push('Pan the targeted clip full left via setPan.')
  }
  if (/pan this right|pan (the |this )?(audio |clip )?right|pan right/i.test(lower) && clip && !commands.some(c => c.kind === 'setPan')) {
    commands.push(cmd({ kind: 'setPan', clipId: clip.id, pan: 1, label: 'Pan right' }))
    notes.push('Pan the targeted clip full right via setPan.')
  }
  if (/center the audio|pan (this |the )?(audio )?center|pan to center/i.test(lower) && clip) {
    commands.push(cmd({ kind: 'setPan', clipId: clip.id, pan: 0, label: 'Pan center' }))
    notes.push('Center the targeted clip pan via setPan.')
  }
  if (/add a dissolve|crossfade|cross dissolve|dissolve here/i.test(lower)) {
    const pair = pairForPlayhead(project, playhead)
    if (pair) {
      commands.push(cmd({
        kind: 'addTransition',
        outgoingClipId: pair.outgoing.id,
        incomingClipId: pair.incoming.id,
        transitionKind: 'dissolve',
        duration: fromSeconds(1, ts),
        label: 'Add dissolve',
      }))
      notes.push('Add a dissolve between the cut under the playhead.')
    } else {
      notes.push('Dissolve needs two adjacent clips on the video track.')
    }
  }
  if (/make this transition one second|dissolve (to |for )?one second|transition one second/i.test(lower)) {
    const existing = project.timeline.tracks.flatMap(t => t.transitions)[0]
    if (existing) {
      commands.push(cmd({ kind: 'updateTransition', transitionId: existing.id, duration: fromSeconds(1, ts), label: 'Dissolve 1s' }))
      notes.push('Set dissolve duration to one second.')
    }
  }
  if (/remove this dissolve|remove the (dissolve|transition)/i.test(lower)) {
    const existing = project.timeline.tracks.flatMap(t => t.transitions)[0]
    if (existing) {
      commands.push(cmd({ kind: 'removeTransition', transitionId: existing.id, label: 'Remove dissolve' }))
      notes.push('Remove the dissolve via removeTransition.')
    }
  }
  if (/apply this look|apply (the )?(cinematic|luxury gold) look/i.test(lower) && clip) {
    const filterId = /cinematic/.test(lower) ? 'cinematic' : 'luxury-gold'
    commands.push(cmd({ kind: 'applyFilter', clipId: clip.id, filterId, amount: 0.8, label: 'Apply look' }))
    notes.push(`Apply ${filterId} look via applyFilter. Render-lowered eq/sepia/hue.`)
  }
  if (/move (the )?logo into the safe area|logo (into|to) (the )?safe/i.test(lower)) {
    const logoOv = project.timeline.overlays.find(o => o.kind === 'logo')
    if (logoOv) {
      commands.push(cmd({ kind: 'moveTitle', overlayId: logoOv.id, x: logoOv.x, y: logoOv.y, clampToSafe: true, label: 'Logo to safe area' }))
      notes.push('Clamp the logo into title-safe via moveTitle. Original graphic unchanged.')
    } else {
      notes.push('No logo overlay to move.')
    }
  }
  if (/move captions? into safe area|captions? into (the )?safe/i.test(lower)) {
    if (selectedCue) {
      commands.push(cmd({ kind: 'updateCaption', cueId: selectedCue.id, clampToSafe: true, label: 'Caption to safe area' }))
      notes.push('Propose moving the caption into title-safe. Does not auto-move until committed.')
    }
  }
  if (/text white with a dark background|white with a dark background|white text.*dark/i.test(lower)) {
    if (selectedCue) {
      commands.push(cmd({
        kind: 'updateCaption',
        cueId: selectedCue.id,
        color: '#FFFFFF',
        background: 'rgba(8,4,0,0.72)',
        backgroundOpacity: 0.72,
        label: 'White on dark',
      }))
      notes.push('Caption fill white with dark box via updateCaption.')
    } else if (selectedOverlay?.kind === 'title') {
      commands.push(cmd({
        kind: 'updateTitle',
        overlayId: selectedOverlay.id,
        color: '#FFFFFF',
        background: 'rgba(8,4,0,0.72)',
        label: 'White on dark',
      }))
      notes.push('Title fill white with dark box via updateTitle.')
    }
  }

  if (/dead space|remove silence|tighten/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'trimClip',
        clipId: clip.id,
        edge: 'in',
        to: { ticks: clip.start.ticks + Math.round(clip.duration.ticks * 0.04), timescale: clip.start.timescale },
        label: 'Trim in-point to remove dead space',
      }))
      commands.push(cmd({
        kind: 'trimClip',
        clipId: clip.id,
        edge: 'out',
        to: { ticks: clip.start.ticks + Math.round(clip.duration.ticks * 0.94), timescale: clip.start.timescale },
        label: 'Trim out-point to remove dead space',
      }))
    }
    notes.push('Trim head/tail dead space on the targeted video clip.')
  }
      if (/split .*playhead|split this clip/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'splitClip',
        clipId: clip.id,
        at: { ticks: Math.round(playhead * ts), timescale: ts },
        label: 'Split at playhead',
      }))
      notes.push('Split the targeted clip at the playhead.')
    }
  }
  if (/\blift\b/i.test(lower)) {
    if (clip) {
      commands.push(cmd({ kind: 'liftClip', clipId: clip.id, label: 'Lift clip' }))
      notes.push('Lift the targeted clip and leave a gap.')
    }
  }
  if (/\bextract\b/i.test(lower)) {
    if (clip) {
      commands.push(cmd({ kind: 'extractClip', clipId: clip.id, label: 'Extract clip' }))
      notes.push('Extract the targeted clip and close the gap.')
    }
  }
  if (/duplicate/i.test(lower)) {
    if (clip) {
      commands.push(cmd({ kind: 'duplicateClip', clipId: clip.id, label: 'Duplicate clip' }))
      notes.push('Duplicate the targeted clip as an EditCommand.')
    }
  }
  if (/\bappend\b/i.test(lower) && !commands.some(c => c.kind === 'appendClip')) {
    const asset = project.assets.find(a => a.kind === 'video') ?? project.assets[0]
    const track = project.timeline.tracks.find(t => t.kind === 'video')
    if (asset && track) {
      commands.push(cmd({ kind: 'appendClip', trackId: track.id, assetId: asset.id, label: 'Append clip' }))
      notes.push('Append the selected asset to the end of the track.')
    }
  }
  if (/\boverwrite\b/i.test(lower)) {
    const asset = project.assets.find(a => a.kind === 'video') ?? project.assets[0]
    const track = project.timeline.tracks.find(t => t.kind === 'video')
    if (asset && track) {
      commands.push(cmd({
        kind: 'overwriteClip',
        trackId: track.id,
        assetId: asset.id,
        start: { ticks: Math.round(playhead * ts), timescale: ts },
        duration: fromSeconds(Math.min(2, toSeconds(asset.duration)), ts),
        label: 'Overwrite at playhead',
      }))
      notes.push('Overwrite at the playhead, carving overlapping clips.')
    }
  }
  if (/ripple trim/i.test(lower) && clip) {
    commands.push(cmd({
      kind: 'rippleTrim',
      clipId: clip.id,
      edge: 'out',
      to: { ticks: Math.round(playhead * ts), timescale: ts },
      label: 'Ripple trim out',
    }))
    notes.push('Ripple-trim the targeted clip to the playhead.')
  }
  if (/\broll\b/i.test(lower) && clip) {
    const track = project.timeline.tracks.find(t => t.clips.some(c => c.id === clip.id))
    const sorted = [...(track?.clips ?? [])].sort((a, b) => a.start.ticks - b.start.ticks)
    const index = sorted.findIndex(c => c.id === clip.id)
    const incoming = sorted[index + 1]
    if (incoming) {
      commands.push(cmd({
        kind: 'rollEdit',
        outgoingClipId: clip.id,
        incomingClipId: incoming.id,
        to: { ticks: Math.round(playhead * ts), timescale: ts },
        label: 'Roll edit',
      }))
      notes.push('Roll the edit between the selected clip and the next clip.')
    }
  }
  if (/\bslip\b/i.test(lower) && clip) {
    commands.push(cmd({
      kind: 'slipClip',
      clipId: clip.id,
      delta: fromSeconds(/back|earlier|left/.test(lower) ? -0.25 : 0.25, ts),
      label: 'Slip clip',
    }))
    notes.push('Slip the targeted clip through its source media.')
  }
  if (/\bslide\b/i.test(lower) && clip) {
    commands.push(cmd({
      kind: 'slideClip',
      clipId: clip.id,
      start: {
        ticks: clip.start.ticks + fromSeconds(/back|earlier|left/.test(lower) ? -0.25 : 0.25, ts).ticks,
        timescale: clip.start.timescale,
      },
      label: 'Slide clip',
    }))
    notes.push('Slide the targeted clip between its neighbors.')
  }
  if (/\bextend\b/i.test(lower) && clip) {
    commands.push(cmd({
      kind: 'extendEdit',
      clipId: clip.id,
      to: { ticks: Math.round(playhead * ts), timescale: ts },
      label: 'Extend edit',
    }))
    notes.push('Extend the targeted clip out-point to the playhead.')
  }
  if (/add (a )?marker|mark this/i.test(lower)) {
    commands.push(cmd({
      kind: 'addMarker',
      time: { ticks: Math.round(playhead * ts), timescale: ts },
      label: 'Marker',
    }))
    notes.push('Add a timeline marker at the playhead.')
  }
  if (/^redo\b|\bredo that\b|\bredo last\b/i.test(lower)) {
    commands.push(cmd({ kind: 'redo', label: 'Redo' }))
    notes.push('Redo the last undone EditCommand.')
  }
  if (/trim the beginning|trim .*one second|trim in by/i.test(lower)) {
    if (clip) {
      const to = { ticks: clip.start.ticks + fromSeconds(1, clip.start.timescale).ticks, timescale: clip.start.timescale }
      commands.push(cmd({ kind: 'trimClip', clipId: clip.id, edge: 'in', to, label: 'Trim beginning by one second' }))
      notes.push('Trim the beginning of the targeted clip by one second.')
    }
  }
  if (/stop following this subject|stop following (her|him|them|this)/i.test(lower)) {
    if (clip) commands.push(cmd({ kind: 'clearTrack', clipId: clip.id }))
    notes.push('Clear TrackSubject and VirtualCamera follow for this clip. Does not delete media.')
  }
  if (/re-?track this shot|retrack this/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'trackSubject',
        clipId: clip.id,
        label: 'Primary talent',
        subjectKind: 'person',
      }))
    }
    notes.push('Re-run TrackSubject on the selected continuous clip. Shot-local only — not identity.')
  }
  if (/use cinematic follow|cinematic follow/i.test(lower)) {
    commands.push(cmd({ kind: 'setVirtualCamera', mode: 'CINEMATIC_FOLLOW', outputAspect: '9:16' }))
    notes.push('Apply CINEMATIC FOLLOW VirtualCamera framing. Existing TrackSubject stays authoritative.')
  }
  if (/keep (her|him|them) centered/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'trackSubject',
        clipId: clip.id,
        label: 'Primary talent',
        subjectKind: 'person',
      }))
    }
    commands.push(cmd({ kind: 'setVirtualCamera', mode: 'CENTER_LOCK', outputAspect: project.timeline.aspect }))
    notes.push('Keep the selected person centered (CENTER LOCK). Shot-local follow, not biometric ID.')
  }
  if (/put (him|her|them) on the left third/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'trackSubject',
        clipId: clip.id,
        label: 'Primary talent',
        subjectKind: 'person',
      }))
    }
    commands.push(cmd({ kind: 'setVirtualCamera', mode: 'RULE_OF_THIRDS', outputAspect: project.timeline.aspect }))
    notes.push('Place the selected person on the left third (RULE OF THIRDS).')
  }
  if (/make this vertical and follow (her|him|them)|vertical and follow/i.test(lower)) {
    if (clip) {
      commands.push(cmd({
        kind: 'trackSubject',
        clipId: clip.id,
        label: 'Primary talent',
        subjectKind: 'person',
      }))
    }
    commands.push(cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: 'FACE_LOCK' }))
    commands.push(cmd({
      kind: 'deriveVerticalVersion',
      versionLabel: 'HIGHER VISION DEMO — 9:16 VERTICAL',
      mode: 'FACE_LOCK',
    }))
    notes.push('16:9 → 9:16 auto reframe with FACE LOCK follow of the selected person.')
  }
  if (/follow (her|him|them|this person|the model)/i.test(lower) && !commands.some(c => c.kind === 'trackSubject' || c.kind === 'clearTrack' || c.kind === 'setVirtualCamera' || c.kind === 'autoReframe')) {
    const followMode: SetVirtualCameraCommand['mode'] = /face lock/.test(lower)
      ? 'FACE_LOCK'
      : /upper body/.test(lower)
        ? 'UPPER_BODY'
        : /full body/.test(lower)
          ? 'FULL_BODY'
          : /center/.test(lower)
            ? 'CENTER_LOCK'
            : /rule of thirds/.test(lower)
              ? 'RULE_OF_THIRDS'
              : context.followMode ?? 'FACE_LOCK'
    if (clip) {
      commands.push(cmd({
        kind: 'trackSubject',
        clipId: clip.id,
        label: 'Primary talent',
        subjectKind: 'person',
      }))
    }
    commands.push(cmd({ kind: 'setVirtualCamera', mode: followMode, outputAspect: '9:16' }))
    commands.push(cmd({
      kind: 'deriveVerticalVersion',
      versionLabel: 'HIGHER VISION DEMO — 9:16 VERTICAL',
      mode: followMode,
    }))
    notes.push(`Track the selected person (${followMode}) and derive a 9:16 VirtualCamera version.`)
  }
  if ((/vertical|9:16|reel|reframe|vertical version/i.test(lower)) && !commands.some(c => c.kind === 'deriveVerticalVersion' || c.kind === 'setVirtualCamera' || c.kind === 'autoReframe')) {
    commands.push(cmd({ kind: 'autoReframe', outputAspect: '9:16', mode: /15|fifteen/.test(lower) ? 'RULE_OF_THIRDS' : 'CINEMATIC_FOLLOW' }))
    commands.push(cmd({
      kind: 'deriveVerticalVersion',
      versionLabel: 'HIGHER VISION DEMO — 9:16 VERTICAL',
      mode: /15|fifteen/.test(lower) ? 'RULE_OF_THIRDS' : 'CINEMATIC_FOLLOW',
    }))
    if (/15|fifteen/.test(lower) && clip) {
      commands.push(cmd({
        kind: 'setSpeed',
        clipId: clip.id,
        speed: { n: Math.max(1, Math.round((toSeconds(clip.duration) / 15) * 1000)), d: 1000 },
      }))
      notes.push('Create a 15-second vertical Reel via reframe + speed.')
    } else {
      notes.push('Create an intelligent 9:16 derived version from tracked subject (not a center-crop).')
    }
  }
  if (
    /\bapply(?:\s+the)?(?:\s+(?:selected|current|this))?\s+theme\b/i.test(lower)
    || /\buse\s+(?:the\s+)?(?:current|selected|luxury)\s+theme\b/i.test(lower)
  ) {
    const themeId = project.timeline.themeId || LUXURY_BEAUTY_V1_ID
    if (!commands.some(c => c.kind === 'applyTheme')) {
      commands.push(cmd({ kind: 'applyTheme', themeId }))
    }
    notes.push(`Apply ThemeSpec ${themeId}.`)
  }
  if (/luxury|feel more luxury|luxury beauty/i.test(lower)) {
    if (!commands.some(c => c.kind === 'applyTheme')) {
      commands.push(cmd({ kind: 'applyTheme', themeId: LUXURY_BEAUTY_V1_ID }))
    }
    if (clip && !commands.some(c => c.kind === 'applyFilter')) commands.push(cmd({ kind: 'applyFilter', clipId: clip.id, filterId: 'luxury-gold', amount: 0.72 }))
    notes.push('Apply luxury_beauty_v1 and Luxury Gold filter.')
  }
  if (/add the logo|end card|move the logo/i.test(lower)) {
    if (logo) {
      const startTicks = Math.max(0, dur.ticks - fromSeconds(2.4, dur.timescale).ticks)
      commands.push(cmd({
        kind: 'addLogo',
        assetId: logo.id,
        start: { ticks: startTicks, timescale: dur.timescale },
        duration: fromSeconds(2.4, dur.timescale),
      }))
      notes.push(/move/.test(lower) ? 'Move the logo to the end of the timeline.' : 'Place the Higher Vision logo as an end overlay.')
    } else {
      notes.push('No logo asset ingested yet.')
    }
  }
  if ((/add (a )?captions?\.?$/i.test(lower) || /add a caption/i.test(lower) || /subtitle/i.test(lower)) && !commands.some(c => c.kind === 'updateCaption' || c.kind === 'addTitle')) {
    const start = fromSeconds(playhead, ts)
    commands.push(cmd({
      kind: 'addCaption',
      start,
      end: fromSeconds(playhead + 2.5, ts),
      text: 'Luxury Beauty Demo',
      position: 'bottom',
      fontSize: 38,
    }))
    notes.push('Add a luxury caption cue at the playhead.')
  }
  if (/lower the music|duck|under the voice/i.test(lower)) {
    commands.push(cmd({ kind: 'duckMusic', duckDb: -8 }))
    notes.push('Lower the music track under voice (simple duck).')
  }
  if (/three openings|give me three/i.test(lower)) {
    commands.push(cmd({ kind: 'createVersion', versionLabel: 'Version — opening A (close-up)', createdBy: 'ai-director' }))
    commands.push(cmd({ kind: 'createVersion', versionLabel: 'Version — opening B (reveal)', createdBy: 'ai-director' }))
    commands.push(cmd({ kind: 'createVersion', versionLabel: 'Version — opening C (product)', createdBy: 'ai-director' }))
    notes.push('Create three opening versions. Prior versions are preserved.')
  }
  if (/cinematic version/i.test(lower)) {
    commands.push(cmd({ kind: 'applyTheme', themeId: LUXURY_BEAUTY_V1_ID }))
    if (clip) commands.push(cmd({ kind: 'applyFilter', clipId: clip.id, filterId: 'cinematic', amount: 0.8 }))
    commands.push(cmd({ kind: 'createVersion', versionLabel: 'Version — cinematic pass', createdBy: 'ai-director' }))
    notes.push('Cinematic look + new version snapshot.')
  }
  if (/cut this on the beat|on the beat/i.test(lower)) {
    const before = commands.length
    project.timeline.markers.filter(m => m.kind === 'beat').slice(0, 6).forEach(marker => {
      if (clip && marker.time.ticks > clip.start.ticks && marker.time.ticks < clip.start.ticks + clip.duration.ticks) {
        commands.push(cmd({ kind: 'splitClip', clipId: clip.id, at: marker.time }))
      }
    })
    notes.push(commands.length > before ? 'Split on beat markers.' : 'No beat markers yet — add music first.')
  }
  if (/middle faster|make the middle faster/i.test(lower)) {
    if (clip) commands.push(cmd({ kind: 'setSpeed', clipId: clip.id, speed: { n: 5, d: 4 } }))
    notes.push('Raise playback speed on the primary clip.')
  }
  if (/generate .*beauty shot|missing beauty shot|generate video|establishing shot/i.test(lower)) {
    commands.push(cmd({
      kind: 'generateVideo',
      prompt: /establishing/i.test(lower) ? text : 'Non-identity luxury hair salon beauty B-roll, gold light, no face morphing.',
      insert: false,
    }))
    notes.push('ProviderJob proposal only. Spend is not authorized. No remote generation will run. Timeline is not mutated.')
    requiresSpendApproval = true
    lane = 'provider'
    jobProposal = { kind: 'provider', capability: 'VIDEO_GENERATION', status: 'BLOCKED_PENDING_APPROVAL', execute: false }
  }
  if (/colder|feel colder|cooler grade|make this feel cold|make this shot colder|make this colder|warmer|feel warmer/i.test(lower) || (context.workspacePage === 'color' && /temperature|tint|grade/i.test(lower))) {
    const warmer = /warm/i.test(lower)
    if (clip) commands.push(cmd({ kind: 'applyColor', clipId: clip.id, color: { temperature: warmer ? 0.22 : -0.25 } }))
    const pipeline = {
      schemaVersion: 1,
      outputColorSpace: 'display-referred',
      nodes: [
        ...project.colorPipeline.nodes.filter(n => n.type !== 'temp-tint'),
        { id: 'dir-temp', type: 'temp-tint', enabled: true, params: { temperature: warmer ? 0.22 : -0.25, tint: 0 } },
      ],
    }
    commands.push(cmd({ kind: 'updateColorPipeline', pipeline }))
    notes.push('ColorPipeline proposal: temp-tint. Preview/commit/reject still apply. Does not silently mutate grade.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false }
  }
  if (/add contrast/i.test(lower)) {
    commands.push(cmd({
      kind: 'updateColorPipeline',
      pipeline: {
        schemaVersion: 1,
        outputColorSpace: 'display-referred',
        nodes: [
          ...project.colorPipeline.nodes.filter(n => n.type !== 'contrast-pivot'),
          { id: 'dir-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.2, pivot: 0.5 } },
        ],
      },
    }))
    notes.push('ColorPipeline proposal: contrast-pivot. Preview before commit.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false }
  }
  if (/reduce saturation|desaturat/i.test(lower)) {
    commands.push(cmd({
      kind: 'updateColorPipeline',
      pipeline: {
        schemaVersion: 1,
        outputColorSpace: 'display-referred',
        nodes: [
          ...project.colorPipeline.nodes.filter(n => n.type !== 'saturation'),
          { id: 'dir-sat', type: 'saturation', enabled: true, params: { saturation: -0.25 } },
        ],
      },
    }))
    notes.push('ColorPipeline proposal: saturation. Preview before commit.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false }
  }
  if (/lift the shadows|lift shadows/i.test(lower)) {
    commands.push(cmd({
      kind: 'updateColorPipeline',
      pipeline: {
        schemaVersion: 1,
        outputColorSpace: 'display-referred',
        nodes: [
          ...project.colorPipeline.nodes.filter(n => n.type !== 'lift-gamma-gain'),
          { id: 'dir-lift', type: 'lift-gamma-gain', enabled: true, params: { lift: [0.08, 0.08, 0.08], gamma: [1, 1, 1], gain: [1, 1, 1] } },
        ],
      },
    }))
    notes.push('ColorPipeline proposal: lift-gamma-gain. Preview before commit.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false }
  }
  if (/cut the low rumble|low rumble|high-?pass|clean the dialogue|denoise|dereverb|isolate (the )?voice/i.test(lower)) {
    const graph = {
      ...project.audioGraph,
      channels: project.audioGraph.channels.map((ch, i) => i === 0 ? {
        ...ch,
        inserts: [
          ...ch.inserts.filter(ins => ins.kind !== 'eq'),
          { kind: 'eq', enabled: true, highpassHz: 120, lowpassHz: null, bands: [] },
        ],
      } : ch),
    }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: HPF on the first track channel. Preview/commit required. No silent mix mutation.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/lower this track/i.test(lower)) {
    const graph = { ...project.audioGraph, channels: project.audioGraph.channels.map((ch, i) => i === 0 ? { ...ch, volume: 0.6 } : ch) }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: first channel volume 0.6. Preview before commit.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/pan this left/i.test(lower)) {
    const graph = { ...project.audioGraph, channels: project.audioGraph.channels.map((ch, i) => i === 0 ? { ...ch, pan: -0.8 } : ch) }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: pan first channel left. Preview before commit.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/compress the dialogue/i.test(lower)) {
    const graph = {
      ...project.audioGraph,
      channels: project.audioGraph.channels.map((ch, i) => i === 0 ? {
        ...ch,
        inserts: [...ch.inserts.filter(ins => ins.kind !== 'compressor'), { kind: 'compressor', enabled: true, thresholdDb: -20, ratio: 4, attackMs: 12, releaseMs: 80, makeupDb: 3 }],
      } : ch),
    }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: compressor on first channel. Preview before commit.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/fade this down here/i.test(lower)) {
    const t = fromSeconds(playhead)
    const graph = {
      ...project.audioGraph,
      automation: [{
        target: project.audioGraph.channels[0]?.id ?? 'ch-A',
        param: 'volume' as const,
        keyframes: [
          { time: fromSeconds(Math.max(0, playhead - 0.5)), value: 1 },
          { time: t, value: 0.2 },
        ],
      }],
    }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: volume automation fade at playhead. Preview before commit.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/blur the tracked background|tracked background blur/i.test(lower) || /blur this area|blur this/i.test(lower) || (context.workspacePage === 'vfx' && /blur/i.test(lower))) {
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id ?? ''
    const subjectId = project.timeline.subjects[0]?.id
    const graph = /tracked background/i.test(lower) && subjectId
      ? firstTrackedBackgroundBlurGraph(project.id, assetId, subjectId, 10)
      : firstBlurGraph(project.id, assetId, 8)
    commands.push(cmd({ kind: 'updateEffectGraph', graph }))
    notes.push(/tracked background/i.test(lower)
      ? 'EffectGraph proposal: TRACKED GEOMETRIC BACKGROUND BLUR (Mask invert + TrackerRef + Blur). Not semantic person segmentation. Preview/commit required.'
      : 'EffectGraph proposal: Blur node (radius 8). TRACKED GEOMETRIC BACKGROUND BLUR if Mask invert + TrackerRef are attached. Not semantic person segmentation. Preview/commit required.')
    lane = 'vfx'
    jobProposal = { kind: 'vfx', status: 'proposal', execute: false }
  }
  if (/match this shot to the reference|match to reference|shot match/i.test(lower)) {
    notes.push('SHOT MATCH proposal: statistical luma/RGB/contrast/temperature. Preview then commit/reject. Does not silently apply. Not a cinematic match.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false, capability: 'SHOT_MATCH' }
    commands.push(cmd({ kind: 'updateColorPipeline', pipeline: project.colorPipeline }))
  }
  if (/qualify the shadows and cool them|qualify the shadows|luma qualifier|cool the shadows/i.test(lower)) {
    commands.push(cmd({
      kind: 'updateColorPipeline',
      pipeline: {
        schemaVersion: 1,
        outputColorSpace: 'display-referred',
        nodes: [
          ...project.colorPipeline.nodes.filter(n => n.type !== 'luma-qualifier' && n.type !== 'temp-tint'),
          { id: 'dir-qual', type: 'luma-qualifier', enabled: true, params: { low: 0, high: 0.42, softness: 0.08, invert: false } },
          { id: 'dir-temp', type: 'temp-tint', enabled: true, params: { temperature: -0.35, tint: 0 } },
        ],
      },
    }))
    notes.push('ColorPipeline proposal: LUMA qualifier on shadows + cooler temp-tint. Not HSL. Preview/commit required. Does not silently apply.')
    lane = 'color'
    jobProposal = { kind: 'color', status: 'proposal', execute: false }
  }
  if (/pan this left to right and limit master|pan this left to right and limit/i.test(lower)) {
    const ch = project.audioGraph.channels[0]?.id ?? 'ch-A'
    const graph = {
      ...project.audioGraph,
      buses: project.audioGraph.buses.map(b => b.kind === 'master'
        ? { ...b, inserts: [...b.inserts.filter(i => i.kind !== 'limiter'), { kind: 'limiter', enabled: true, ceilingDb: -6 }] }
        : b),
      automation: [{
        target: ch,
        param: 'pan' as const,
        keyframes: [
          { time: fromSeconds(0), value: -1 },
          { time: fromSeconds(1), value: 0 },
          { time: fromSeconds(2), value: 1 },
        ],
      }],
    }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: pan automation left→right (linear) + master limiter ceiling -6 dBFS. Preview/commit required.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  } else if (/pan this from left to right|pan from left to right|pan left to right/i.test(lower)) {
    const ch = project.audioGraph.channels[0]?.id ?? 'ch-A'
    const graph = {
      ...project.audioGraph,
      automation: [{
        target: ch,
        param: 'pan' as const,
        keyframes: [
          { time: fromSeconds(0), value: -1 },
          { time: fromSeconds(1), value: 0 },
          { time: fromSeconds(2), value: 1 },
        ],
      }],
    }
    commands.push(cmd({ kind: 'updateAudioGraph', graph }))
    notes.push('AudioGraph proposal: pan automation left → center → right (linear interpolation). Preview/commit required.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
  }
  if (/generate a voice line|generate voice/i.test(lower)) {
    notes.push('VOICE_SYNTHESIS requires local Piper INSTALLED. Wave 5 install is not authorized. LOCAL ENGINE NOT INSTALLED / INSTALL_APPROVAL_REQUIRED. No fake WAV. Generate does not install.')
    lane = 'provider'
    jobProposal = { kind: 'provider', capability: 'VOICE_SYNTHESIS', status: 'INSTALL_APPROVAL_REQUIRED', execute: false }
  }
  if (/put this image over the shot|overlay (this|the) (image|graphic)|composite this/i.test(lower) || ((context.workspacePage === 'vfx' || /remove (the )?person in the background/i.test(lower)) && /remove|roto|keyer|composit/i.test(lower))) {
    notes.push('EffectGraph proposal: MediaIn A + MediaIn B → Transform → Mask → Merge → MediaOut. No compositor runs until a VFX job executes. Invalid graphs are rejected without mutating source media.')
    lane = 'vfx'
    jobProposal = { kind: 'vfx', status: 'proposal', execute: false }
  }
  if (/key out the green|chroma key|keyer/i.test(lower)) {
    notes.push('EffectGraph Keyer proposal: chromakey. Typed proposal only. No silent timeline mutation.')
    lane = 'vfx'
    jobProposal = { kind: 'vfx', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    if (assetId) {
      commands.push(cmd({
        kind: 'updateEffectGraph',
        graph: firstChromaKeyGraph(project.id, assetId),
        label: 'Propose chroma key',
      }))
      requiresConfirmation = true
    }
  }
  if (/bring this to\s*(-?\d+)\s*lufs|normalize (to )?-?\d+ lufs|-14 lufs/i.test(lower)) {
    notes.push('Loudness target proposal only. Do NOT auto-normalize. AudioGraph.loudnessTargetLufs is metadata until Commander commits loudnorm.')
    lane = 'audio'
    jobProposal = { kind: 'audio', status: 'proposal', execute: false }
    requiresConfirmation = true
  }
  if (/find clipping|qc (this|before)|quality control|preflight/i.test(lower)) {
    notes.push('QC proposal. Technical detectors only. No editorial judgment. No silent deliver.')
    lane = 'review'
    jobProposal = { kind: 'qc', status: 'proposal', execute: false }
  }
  if (/transcribe this clip|transcribe (the )?clip|run asr|make a transcript/i.test(lower)) {
    const asr = asrGateStatus()
    notes.push(asr.usableNow
      ? 'ASR proposal. Local whisper.cpp will transcribe this clip. Analysis does not edit the timeline.'
      : `ASR proposal. ${WAVE9_ASR_RECOMMENDATION.status}. ${WAVE9_ASR_RECOMMENDATION.reason} Analysis does not edit the timeline.`)
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'ASR_TRANSCRIPTION', status: asr.usableNow ? 'proposal' : 'INSTALL_APPROVAL_REQUIRED', execute: false }
  }
  if (/propose captions from transcript|captions from transcript|add captions/i.test(lower)) {
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? readTranscriptSync(project.id, assetId) : null
    if (doc && doc.segments.length) {
      const proposals = proposeCaptionsFromTranscript(doc).slice(0, 24)
      for (const cap of proposals) {
        commands.push(cmd({ kind: 'addCaption', start: cap.start, end: cap.end, text: cap.text, label: 'Caption proposal from transcript' }))
      }
      notes.push(`${proposals.length} caption cues proposed from transcript. Does not overwrite until Commander commits. Preview then commit.`)
      requiresConfirmation = true
    } else {
      notes.push(asrGateStatus().usableNow
        ? 'No transcript yet. Local ASR can transcribe this clip after approval. I will not invent captions.'
        : 'No transcript.json to propose captions from. Speech recognition is not ready.')
    }
    lane = 'edit'
  }
  if (/enroll this person as |enroll .+ as /i.test(lower)) {
    notes.push('BIOMETRIC enrollment requires explicit Commander confirmation. Casual mention does not enroll. Mode remains OFF until acknowledged.')
    lane = 'analysis'
    requiresConfirmation = true
    jobProposal = { kind: 'analysis', capability: 'BIOMETRIC_ENROLLMENT', status: 'BLOCKED_PENDING_APPROVAL', execute: false }
  }
  if (/find similar shots|visually similar|semantic search/i.test(lower)) {
    notes.push(embeddingsUsableNow()
      ? 'Embedding similarity search of derived index. Source disclosed as embedding.'
      : 'Semantic embedding search INSTALL_APPROVAL_REQUIRED. CLIP/OpenCLIP not installed. No silent download.')
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'EMBEDDINGS', status: 'INSTALL_APPROVAL_REQUIRED', execute: false }
  }
  if (/show me person \d+|find where this person appears|person 1 across/i.test(lower)) {
    notes.push('Person continuity search uses Person N labels. Visual track continuity is not legal identity. No timeline edit.')
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'PERSON_CONTINUITY', status: 'proposal', execute: false }
  }
  if (/find every shot with a (car|dog|person)|find the (car|dog)|moments with a dog|two people/i.test(lower)) {
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'OBJECT_RECOGNITION', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? loadObservationsSync(project.id, assetId) : null
    const hits = doc ? searchObjectObservations(doc.observations, lower) : []
    if (hits[0] && assetId) {
      sourceSeek = { assetId, time: hits[0].timestamp, reason: hits[0].evidence }
      sourceActions.push({ kind: 'seek', time: hits[0].timestamp, assetId })
      notes.push(`Object observation ${hits[0].evidence}. Source Monitor seek. Object ≠ identity. No timeline edit.`)
    } else {
      notes.push('No persisted object detections. Detector INSTALL_APPROVAL_REQUIRED (YOLOX-nano Apache-2 + ONNX). No invented cars/dogs.')
    }
  }
  if (/transcript.*(search|find)|find .* in (the )?transcript|words in transcript|find where i say|go to the part where i mention|where i (say|mention)/i.test(lower)) {
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const spoken = lower.match(/(?:where i (?:say|mention)|find where i say|mention)\s+["“]?(.+?)["”]?$/)
    const phrase = (spoken?.[1] ?? lower.replace(/.*transcript[^\w]+/i, '')).replace(/[.?!]$/, '').trim() || lower
    const doc = assetId ? readTranscriptSync(project.id, assetId) : null
    const hit = doc ? searchTranscript(doc, phrase)[0] : null
    if (hit && assetId) {
      sourceSeek = { assetId, time: hit.timestamp, reason: hit.evidence }
      sourceActions.push({ kind: 'seek', time: hit.timestamp, assetId })
      notes.push(`Transcript hit "${hit.text}" at ${toSeconds(hit.timestamp).toFixed(3)}s. Source=${hit.source}. No timeline edit.`)
    } else {
      notes.push(doc ? 'No matching spoken words in the transcript.' : (asrGateStatus().usableNow ? 'No transcript yet. Transcribe this clip first.' : 'No transcript.json. Speech recognition is not ready.'))
    }
    lane = 'analysis'
  }
  void ACTION_RECOGNITION_STATUS
  if (/find the highest-motion|highest motion|highest-motion section|find the most active moment|most active moment|find every close-up|close-up of|search (the )?media/i.test(lower)) {
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'VISION_ANALYSIS', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? loadObservationsSync(project.id, assetId) : null
    const hit = doc ? highestMotionHit(doc) : null
    if (hit && assetId) {
      sourceSeek = { assetId, time: hit.start, reason: hit.reason }
      sourceActions.push({ kind: 'selectAsset', assetId })
      sourceActions.push({ kind: 'seek', time: hit.start, assetId })
      notes.push(`Video Intelligence evidence: ${hit.reason} at ${toSeconds(hit.start).toFixed(3)}s confidence=${hit.confidence.toFixed(2)}. Source Monitor seek proposed. Analysis does not edit the timeline.`)
    } else {
      notes.push('Analysis search proposal. Highest-motion seek requires a persisted observations file. Person observation is not identity. No silent edit.')
    }
  }
  if (/show me quiet sections|quiet section|silence/i.test(lower)) {
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'VISION_ANALYSIS', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? loadObservationsSync(project.id, assetId) : null
    const hit = doc ? searchPersistedObservations(doc, { audioState: 'SILENCE' })[0] : null
    if (hit && assetId) {
      sourceSeek = { assetId, time: hit.start, reason: hit.reason }
      sourceActions.push({ kind: 'seek', time: hit.start, assetId })
      notes.push(`Quiet section at ${toSeconds(hit.start).toFixed(3)}s (${hit.reason}, confidence=${hit.confidence.toFixed(2)}). No timeline edit.`)
    } else {
      notes.push('No SILENCE observations persisted. Search does not invent quiet sections.')
    }
  }
  if (/show me where audio is active|show me active audio|active audio sections|where audio is active/i.test(lower)) {
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'VISION_ANALYSIS', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? loadObservationsSync(project.id, assetId) : null
    const hit = doc ? searchPersistedObservations(doc, { audioState: 'AUDIO ACTIVE' })[0] : null
    if (hit && assetId) {
      sourceSeek = { assetId, time: hit.start, reason: hit.reason }
      sourceActions.push({ kind: 'seek', time: hit.start, assetId })
      notes.push(`Active audio at ${toSeconds(hit.start).toFixed(3)}s (${hit.reason}, confidence=${hit.confidence.toFixed(2)}). No timeline edit.`)
    } else {
      notes.push('No AUDIO ACTIVE observations persisted.')
    }
  }
  if (/find shot boundaries|shot boundary|show me the shot boundaries|shot boundaries/i.test(lower)) {
    lane = 'analysis'
    jobProposal = { kind: 'analysis', capability: 'VISION_ANALYSIS', status: 'proposal', execute: false }
    const assetId = context.sourceAssetId ?? project.assets.find(a => a.kind === 'video')?.id
    const doc = assetId ? loadObservationsSync(project.id, assetId) : null
    const shots = doc ? doc.observations.filter(o => o.scene === 'SHOT' || o.scene === 'SCENE_BOUNDARY') : []
    notes.push(shots.length
      ? `Shot observations: ${shots.length}. Sample.mp4 is a single-take unless FFmpeg scene_score exceeded 0.2. Analysis does not invent cuts.`
      : 'No shot observations persisted.')
    if (shots[0] && assetId) {
      sourceSeek = { assetId, time: shots[0].timestamp, reason: shots[0].scene ?? 'SHOT' }
      sourceActions.push({ kind: 'seek', time: shots[0].timestamp, assetId })
    }
  }
  if (/prepare a 9:16|9:16 social/i.test(lower)) {
    if (!commands.some(c => c.kind === 'render')) commands.push(cmd({ kind: 'render', aspect: '9:16' }))
    notes.push('Queue 9:16 on the shared RenderQueue.')
  }
  if (/continuity/i.test(lower) && (context.workspacePage === 'review' || /check this scene/i.test(lower))) {
    notes.push('Continuity QC is RESEARCHED. Review lists versions and renders on this same project.')
  }
  if (/create a version called\s+(.+)/i.test(text) && !commands.some(c => c.kind === 'createVersion')) {
    const named = text.match(/create a version called\s+["“]?([^"”]+)["”]?/i)?.[1]?.trim()
    if (named) {
      commands.push(cmd({ kind: 'createVersion', versionLabel: named.replace(/\.$/, ''), createdBy: 'ai-director' }))
      notes.push(`Create version "${named.replace(/\.$/, '')}" via createVersion.`)
    }
  }
  if (/save this as an alternate cut|alternate cut/i.test(lower) && !commands.some(c => c.kind === 'createVersion')) {
    commands.push(cmd({ kind: 'createVersion', versionLabel: 'ALTERNATE CUT', createdBy: 'ai-director' }))
    notes.push('Save the current committed timeline as ALTERNATE CUT.')
  }
  if (/create a 9:16 version|create (a )?vertical (cut|version)/i.test(lower) && !commands.some(c => c.kind === 'deriveVerticalVersion' || c.kind === 'createVersion')) {
    commands.push(cmd({ kind: 'deriveVerticalVersion', versionLabel: '9:16 VERSION' }))
    notes.push('Derive a 9:16 version from the current master. Not an overwrite.')
  }
  if (/show my versions|open versions|version browser/i.test(lower)) {
    openVersionBrowser = true
    notes.push('Open the Version Browser. No project mutation.')
  }
  if (/compare (.+) with (.+)/i.test(lower) || /compare version/i.test(lower)) {
    const match = text.match(/compare\s+(.+?)\s+with\s+(.+?)\.?$/i)
    const left = match ? findVersionByLabel(project, match[1]) : project.versions[0]
    const right = match ? findVersionByLabel(project, match[2]) : project.versions.at(-1)
    if (left && right) {
      compareVersionIds = [left.id, right.id]
      openVersionBrowser = true
      notes.push(`METADATA / TIMELINE COMPARISON: ${left.label} vs ${right.label}. No synchronized dual-video viewer in this slice.`)
    } else {
      notes.push('Name two existing versions to compare.')
    }
  }
  if (/restore version\s+(.+)/i.test(lower) || /restore ["“]?(.+)["”]?$/i.test(lower)) {
    const match = text.match(/restore (?:version\s+)?["“]?(.+?)["”]?\.?$/i)
    const target = match ? findVersionByLabel(project, match[1]) : project.versions[0]
    if (target) {
      commands.push(cmd({
        kind: 'restoreVersion',
        versionId: target.id,
        confirmed: false,
        label: `Restore ${target.label}`,
      }))
      requiresConfirmation = true
      notes.push(`Propose restore of "${target.label}". Restore requires explicit Commander confirmation and is not executed by AI.`)
    }
  }

  if (/first cut|ai first cut/i.test(lower)) {
    commands.unshift(cmd({
      kind: 'createVersion',
      versionLabel: 'Version — AI first cut',
      createdBy: 'ai-director',
    }))
    commands.push(cmd({ kind: 'applyTheme', themeId: LUXURY_BEAUTY_V1_ID }))
    notes.push('AI FIRST CUT creates a new project version before applying the luxury theme.')
    requiresNewVersion = true
  }
  if (/render the current version with all active vfx, color, and audio/i.test(lower)
    || (context.workspacePage === 'deliver' && /render the current version/i.test(lower))) {
    const aspect = project.timeline.aspect === '9:16' || project.timeline.aspect === '1:1' ? project.timeline.aspect : '16:9'
    if (!commands.some(c => c.kind === 'render')) commands.push(cmd({ kind: 'render', aspect }))
    lane = 'deliver'
    jobProposal = { kind: 'render', status: 'proposal', execute: false }
    notes.push('Unified RenderEngine: one job compiling EffectGraph + ColorPipeline + AudioGraph from the current version. Not three sequential lane jobs. Explicit Commander render action still required.')
  }
  if (/render 9:16|export 9:16/i.test(lower)) {
    commands.push(cmd({ kind: 'render', aspect: '9:16' }))
    notes.push('Queue 9:16 render.')
  }
  if (/render 16:9|export 16:9/i.test(lower)) {
    commands.push(cmd({ kind: 'render', aspect: '16:9' }))
    notes.push('Queue 16:9 render.')
  }
  if (/hair reveal|strongest hair/i.test(lower)) {
    notes.push('Video Intelligence will mark hair-reveal candidates once Watch Video has observations. TrackSubject path is reserved.')
  }
  // HVS-GENERATIVE-VIDEO-01: propose the typed local op. Proposal only; Commander confirms; no timeline insert.
  const generativeOps: HvsGenerateVideoOp[] = []
  const selectedImage = context.sourceAssetId
    ? project.assets.find(a => a.id === context.sourceAssetId && (a.kind === 'image' || a.kind === 'graphic'))
    : undefined
  const generative = parseGenerateVideoUtterance(text, { projectId: project.id, selectedImageAssetId: selectedImage?.id ?? null })
  if (generative) {
    generativeOps.push({ ...generative.op, source: 'ai-director' })
    notes.push(`Local Wan 2.2 hvs.generate.video proposal (${generative.op.request.durationSeconds}s). ${generative.notes.join(' ')}`)
    if (!jobProposal) {
      lane = 'provider'
      jobProposal = { kind: 'provider', capability: 'VIDEO_GENERATION', status: 'proposal', execute: false }
      requiresConfirmation = true
    }
  }

  if (commands.length === 0 && sourceActions.length === 0 && notes.length === 0) {
    commands.push(cmd({
      kind: 'createVersion',
      versionLabel: `AI note — ${text.slice(0, 48)}`,
      createdBy: 'ai-director',
    }))
    notes.push('No canned mapper matched. Created a version bookmark so the utterance is not a tip — extend mapper or attach Video Intelligence evidence.')
  }

  if (requiresNewVersion && !commands.some(c => c.kind === 'createVersion' || c.kind === 'deriveVerticalVersion') && (mode === 'AI_FIRST_CUT' || mode === 'AUTOMATIC_DRAFT')) {
    commands.unshift(cmd({
      kind: 'createVersion',
      versionLabel: 'Version — AI first cut',
      createdBy: 'ai-director',
    }))
  }

  if (context.workspacePage) {
    notes.unshift(`Workspace ${context.workspacePage.toUpperCase()}.`)
  }

  return {
    id: `dir-${Date.now().toString(36)}`,
    mode,
    utterance: text,
    commands,
    sourceActions: sourceActions.length ? sourceActions : undefined,
    summary: notes.join(' ') || 'Structured EditOps proposal.',
    requiresNewVersion,
    requiresConfirmation: requiresConfirmation || undefined,
    openVersionBrowser: openVersionBrowser || undefined,
    compareVersionIds,
    requiresSpendApproval: requiresSpendApproval || undefined,
    lane,
    jobProposal,
    sourceSeek,
    generativeOps: generativeOps.length ? generativeOps : undefined,
  }
}
