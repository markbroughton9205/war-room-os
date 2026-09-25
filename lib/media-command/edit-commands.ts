/**
 * Typed EditCommands. Humans and AI Director share this layer.
 * AI must not click UI. AI cannot mutate arbitrary project state.
 */
import type { CaptionPositionPreset, ColorGrade, Crop, OutputAspect, TextAlignment, Transform } from './types'
import type { MediaTime, Rational } from './time'

export const EDIT_COMMAND_KINDS = [
  'insertClip',
  'overwriteClip',
  'moveClip',
  'splitClip',
  'trimClip',
  'rippleDelete',
  'setTransform',
  'setCrop',
  'setOpacity',
  'setSpeed',
  'reverseClip',
  'freezeFrame',
  'createFreezeFrame',
  'addTransition',
  'updateTransition',
  'removeTransition',
  'setPan',
  'applyEffect',
  'applyFilter',
  'applyTheme',
  'addCaption',
  'updateCaption',
  'addTitle',
  'updateTitle',
  'moveTitle',
  'setTitleStyle',
  'removeTitle',
  'addLowerThird',
  'addLogo',
  'addMusic',
  'addVoice',
  'setVolume',
  'duckMusic',
  'applyColor',
  'trackSubject',
  'correctTrack',
  'reacquireTrack',
  'clearTrack',
  'setVirtualCamera',
  'autoReframe',
  'replaceAsset',
  'generateVideo',
  'generateImage',
  'createVersion',
  'restoreVersion',
  'createVersionFrom',
  'deriveVerticalVersion',
  'setFade',
  'render',
  'undo',
  'redo',
  'appendClip',
  'liftClip',
  'extractClip',
  'rippleTrim',
  'rollEdit',
  'slipClip',
  'slideClip',
  'extendEdit',
  'duplicateClip',
  'addMarker',
  'updateMarker',
  'removeMarker',
  'updateEffectGraph',
  'addEffectNode',
  'removeEffectNode',
  'updateEffectNode',
  'connectEffectNodes',
  'disconnectEffectNodes',
  'updateColorPipeline',
  'copyColorPipeline',
  'pasteColorPipeline',
  'updateAudioGraph',
] as const

export type EditCommandKind = (typeof EDIT_COMMAND_KINDS)[number]

export type EditCommandActor = 'human' | 'ai-director' | 'system'

type BaseCommand = {
  id: string
  kind: EditCommandKind
  actor: EditCommandActor
  createdAt: string
  label?: string
}

export type InsertClipCommand = BaseCommand & {
  kind: 'insertClip'
  trackId: string
  assetId: string
  start: MediaTime
  sourceIn?: MediaTime
  sourceOut?: MediaTime
  duration?: MediaTime
}

export type OverwriteClipCommand = BaseCommand & {
  kind: 'overwriteClip'
  trackId: string
  assetId: string
  start: MediaTime
  duration: MediaTime
  sourceIn?: MediaTime
  sourceOut?: MediaTime
}

export type MoveClipCommand = BaseCommand & {
  kind: 'moveClip'
  clipId: string
  trackId: string
  start: MediaTime
}

export type SplitClipCommand = BaseCommand & {
  kind: 'splitClip'
  clipId: string
  at: MediaTime
}

export type TrimClipCommand = BaseCommand & {
  kind: 'trimClip'
  clipId: string
  edge: 'in' | 'out'
  to: MediaTime
}

export type RippleDeleteCommand = BaseCommand & {
  kind: 'rippleDelete'
  clipId: string
}

export type SetTransformCommand = BaseCommand & {
  kind: 'setTransform'
  clipId: string
  transform: Partial<Transform>
}

export type SetCropCommand = BaseCommand & {
  kind: 'setCrop'
  clipId: string
  crop: Partial<Crop>
}

export type SetOpacityCommand = BaseCommand & {
  kind: 'setOpacity'
  clipId: string
  opacity: number
}

export type SetSpeedCommand = BaseCommand & {
  kind: 'setSpeed'
  clipId: string
  speed: Rational
}

export type ReverseClipCommand = BaseCommand & {
  kind: 'reverseClip'
  clipId: string
  reversed: boolean
}

export type FreezeFrameCommand = BaseCommand & {
  kind: 'freezeFrame'
  clipId?: string
  freeze?: boolean
  assetId?: string
  trackId?: string
  at?: MediaTime
  duration?: MediaTime
  start?: MediaTime
}

export type CreateFreezeFrameCommand = BaseCommand & {
  kind: 'createFreezeFrame'
  clipId?: string
  trackId?: string
  at?: MediaTime
  duration?: MediaTime
  start?: MediaTime
  assetId?: string
}

export type AddTransitionCommand = BaseCommand & {
  kind: 'addTransition'
  outgoingClipId: string
  incomingClipId: string
  transitionKind: string
  duration: MediaTime
}

export type UpdateTransitionCommand = BaseCommand & {
  kind: 'updateTransition'
  transitionId: string
  duration?: MediaTime
  transitionKind?: string
}

export type RemoveTransitionCommand = BaseCommand & {
  kind: 'removeTransition'
  transitionId: string
}

export type SetPanCommand = BaseCommand & {
  kind: 'setPan'
  clipId: string
  pan: number
}

export type ApplyEffectCommand = BaseCommand & {
  kind: 'applyEffect'
  clipId: string
  effectId: string
  params?: Record<string, number | string | boolean>
}

export type ApplyFilterCommand = BaseCommand & {
  kind: 'applyFilter'
  clipId: string
  filterId: string
  amount: number
}

export type ApplyThemeCommand = BaseCommand & {
  kind: 'applyTheme'
  themeId: string
}

export type AddCaptionCommand = BaseCommand & {
  kind: 'addCaption'
  captionTrackId?: string
  start: MediaTime
  end: MediaTime
  text: string
  speaker?: string | null
  position?: 'bottom' | 'top' | 'center'
  positionPreset?: CaptionPositionPreset
  fontFamily?: string
  fontSize?: number
  x?: number
  y?: number
  alignment?: TextAlignment
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  lineSpacing?: number
  maxWidth?: number
  safeAreaLock?: boolean
}

export type UpdateCaptionCommand = BaseCommand & {
  kind: 'updateCaption'
  cueId: string
  captionTrackId?: string
  text?: string
  start?: MediaTime
  end?: MediaTime
  duration?: MediaTime
  position?: 'bottom' | 'top' | 'center'
  positionPreset?: CaptionPositionPreset
  x?: number
  y?: number
  alignment?: TextAlignment
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  lineSpacing?: number
  maxWidth?: number
  safeAreaLock?: boolean
  clampToSafe?: boolean
}

export type AddTitleCommand = BaseCommand & {
  kind: 'addTitle'
  text: string
  secondaryText?: string | null
  start: MediaTime
  duration: MediaTime
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  alignment?: TextAlignment
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  color?: string
  background?: string | null
  outlineColor?: string
  shadow?: boolean
  maxWidth?: number
  positionPreset?: CaptionPositionPreset
  stylePreset?: string
  titleKind?: 'title' | 'lower-third'
  safeAreaLock?: boolean
}

export type UpdateTitleCommand = BaseCommand & {
  kind: 'updateTitle'
  overlayId: string
  text?: string
  secondaryText?: string | null
  start?: MediaTime
  duration?: MediaTime
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  alignment?: TextAlignment
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  color?: string
  background?: string | null
  backgroundOpacity?: number
  outlineColor?: string
  outlineWidth?: number
  shadow?: boolean
  maxWidth?: number
  positionPreset?: CaptionPositionPreset
  titleKind?: 'title' | 'lower-third'
  safeAreaLock?: boolean
}

export type MoveTitleCommand = BaseCommand & {
  kind: 'moveTitle'
  overlayId: string
  x: number
  y: number
  clampToSafe?: boolean
}

export type SetTitleStyleCommand = BaseCommand & {
  kind: 'setTitleStyle'
  overlayId: string
  stylePreset?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  color?: string
  background?: string | null
  alignment?: TextAlignment
  positionPreset?: CaptionPositionPreset
}

export type RemoveTitleCommand = BaseCommand & {
  kind: 'removeTitle'
  overlayId: string
}

export type AddLowerThirdCommand = BaseCommand & {
  kind: 'addLowerThird'
  text: string
  secondaryText?: string | null
  start: MediaTime
  duration: MediaTime
  x?: number
  y?: number
  stylePreset?: string
}

export type AddLogoCommand = BaseCommand & {
  kind: 'addLogo'
  assetId: string
  start: MediaTime
  duration: MediaTime
  x?: number
  y?: number
  scale?: number
}

export type AddMusicCommand = BaseCommand & {
  kind: 'addMusic'
  assetId: string
  start?: MediaTime
  trackId?: string
}

export type AddVoiceCommand = BaseCommand & {
  kind: 'addVoice'
  assetId: string
  start?: MediaTime
  trackId?: string
}

export type SetVolumeCommand = BaseCommand & {
  kind: 'setVolume'
  clipId: string
  volume: number
}

export type DuckMusicCommand = BaseCommand & {
  kind: 'duckMusic'
  musicTrackId?: string
  duckDb: number
}

export type ApplyColorCommand = BaseCommand & {
  kind: 'applyColor'
  clipId: string
  color: Partial<ColorGrade>
}

export type TrackSubjectCommand = BaseCommand & {
  kind: 'trackSubject'
  clipId: string
  label: string
  subjectKind?: 'person' | 'face' | 'body' | 'object'
  seedBox?: { x: number; y: number; width: number; height: number }
  keyframes?: Array<{ time: MediaTime; x: number; y: number; width: number; height: number; confidence: number }>
  status?: 'tracking' | 'lost' | 'reacquired' | 'corrected'
  confidence?: number
}

export type CorrectTrackCommand = BaseCommand & {
  kind: 'correctTrack'
  clipId: string
  at: MediaTime
  box: { x: number; y: number; width: number; height: number; confidence?: number }
}

export type ReacquireTrackCommand = BaseCommand & {
  kind: 'reacquireTrack'
  clipId: string
  from: MediaTime
  seedBox: { x: number; y: number; width: number; height: number }
  keyframes?: Array<{ time: MediaTime; x: number; y: number; width: number; height: number; confidence: number }>
  status?: 'tracking' | 'lost' | 'reacquired' | 'corrected'
  confidence?: number
}

export type ClearTrackCommand = BaseCommand & {
  kind: 'clearTrack'
  clipId: string
}

export type SetVirtualCameraCommand = BaseCommand & {
  kind: 'setVirtualCamera'
  subjectId?: string
  mode: 'CENTER_LOCK' | 'RULE_OF_THIRDS' | 'FACE_LOCK' | 'UPPER_BODY' | 'FULL_BODY' | 'DYNAMIC_FOLLOW' | 'CINEMATIC_FOLLOW'
  outputAspect: OutputAspect
  reset?: boolean
}

export type AutoReframeCommand = BaseCommand & {
  kind: 'autoReframe'
  outputAspect: OutputAspect
  mode?: SetVirtualCameraCommand['mode']
  subjectId?: string
}

export type ReplaceAssetCommand = BaseCommand & {
  kind: 'replaceAsset'
  clipId: string
  assetId: string
}

export type GenerateVideoCommand = BaseCommand & {
  kind: 'generateVideo'
  prompt: string
  insert?: boolean
}

export type GenerateImageCommand = BaseCommand & {
  kind: 'generateImage'
  prompt: string
  insert?: boolean
}

export type CreateVersionCommand = BaseCommand & {
  kind: 'createVersion'
  versionLabel: string
  createdBy: 'human' | 'ai-director' | 'system'
  description?: string
}

export type RestoreVersionCommand = BaseCommand & {
  kind: 'restoreVersion'
  versionId: string
  confirmed: boolean
}

export type CreateVersionFromCommand = BaseCommand & {
  kind: 'createVersionFrom'
  sourceVersionId: string
  versionLabel: string
  createdBy: 'human' | 'ai-director' | 'system'
  description?: string
}

export type DeriveVerticalVersionCommand = BaseCommand & {
  kind: 'deriveVerticalVersion'
  versionLabel?: string
  mode?: SetVirtualCameraCommand['mode']
}

export type SetFadeCommand = BaseCommand & {
  kind: 'setFade'
  clipId: string
  fadeIn?: MediaTime
  fadeOut?: MediaTime
}

export type RenderCommand = BaseCommand & {
  kind: 'render'
  aspect: OutputAspect
}

export type UndoCommand = BaseCommand & {
  kind: 'undo'
}

export type RedoCommand = BaseCommand & {
  kind: 'redo'
}

export type AppendClipCommand = BaseCommand & {
  kind: 'appendClip'
  trackId: string
  assetId: string
  sourceIn?: MediaTime
  sourceOut?: MediaTime
  duration?: MediaTime
}

export type LiftClipCommand = BaseCommand & {
  kind: 'liftClip'
  clipId: string
}

export type ExtractClipCommand = BaseCommand & {
  kind: 'extractClip'
  clipId: string
}

export type RippleTrimCommand = BaseCommand & {
  kind: 'rippleTrim'
  clipId: string
  edge: 'in' | 'out'
  to: MediaTime
}

export type RollEditCommand = BaseCommand & {
  kind: 'rollEdit'
  outgoingClipId: string
  incomingClipId: string
  to: MediaTime
}

export type SlipClipCommand = BaseCommand & {
  kind: 'slipClip'
  clipId: string
  delta: MediaTime
}

export type SlideClipCommand = BaseCommand & {
  kind: 'slideClip'
  clipId: string
  start: MediaTime
}

export type ExtendEditCommand = BaseCommand & {
  kind: 'extendEdit'
  clipId: string
  to: MediaTime
}

export type DuplicateClipCommand = BaseCommand & {
  kind: 'duplicateClip'
  clipId: string
}

export type AddMarkerCommand = BaseCommand & {
  kind: 'addMarker'
  time: MediaTime
  duration?: MediaTime
  label?: string
  kindMarker?: 'generic' | 'beat' | 'chapter' | 'ai'
  color?: string
}

export type UpdateMarkerCommand = BaseCommand & {
  kind: 'updateMarker'
  markerId: string
  time?: MediaTime
  duration?: MediaTime
  label?: string
  color?: string
}

export type RemoveMarkerCommand = BaseCommand & {
  kind: 'removeMarker'
  markerId: string
}

export type UpdateEffectGraphCommand = BaseCommand & {
  kind: 'updateEffectGraph'
  graph: Record<string, unknown>
}

export type AddEffectNodeCommand = BaseCommand & {
  kind: 'addEffectNode'
  graphId?: string
  node: Record<string, unknown>
}

export type RemoveEffectNodeCommand = BaseCommand & {
  kind: 'removeEffectNode'
  graphId?: string
  nodeId: string
}

export type UpdateEffectNodeCommand = BaseCommand & {
  kind: 'updateEffectNode'
  graphId?: string
  nodeId: string
  parameters: Record<string, unknown>
  enabled?: boolean
}

export type ConnectEffectNodesCommand = BaseCommand & {
  kind: 'connectEffectNodes'
  graphId?: string
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
}

export type DisconnectEffectNodesCommand = BaseCommand & {
  kind: 'disconnectEffectNodes'
  graphId?: string
  fromNode: string
  toNode: string
  toPort?: string
}

export type UpdateColorPipelineCommand = BaseCommand & {
  kind: 'updateColorPipeline'
  pipeline: Record<string, unknown>
}

export type CopyColorPipelineCommand = BaseCommand & {
  kind: 'copyColorPipeline'
}

export type PasteColorPipelineCommand = BaseCommand & {
  kind: 'pasteColorPipeline'
  pipeline: Record<string, unknown>
}

export type UpdateAudioGraphCommand = BaseCommand & {
  kind: 'updateAudioGraph'
  graph: Record<string, unknown>
}

export type EditCommand =
  | InsertClipCommand
  | OverwriteClipCommand
  | MoveClipCommand
  | SplitClipCommand
  | TrimClipCommand
  | RippleDeleteCommand
  | SetTransformCommand
  | SetCropCommand
  | SetOpacityCommand
  | SetSpeedCommand
  | ReverseClipCommand
  | FreezeFrameCommand
  | CreateFreezeFrameCommand
  | AddTransitionCommand
  | UpdateTransitionCommand
  | RemoveTransitionCommand
  | SetPanCommand
  | ApplyEffectCommand
  | ApplyFilterCommand
  | ApplyThemeCommand
  | AddCaptionCommand
  | UpdateCaptionCommand
  | AddTitleCommand
  | UpdateTitleCommand
  | MoveTitleCommand
  | SetTitleStyleCommand
  | RemoveTitleCommand
  | AddLowerThirdCommand
  | AddLogoCommand
  | AddMusicCommand
  | AddVoiceCommand
  | SetVolumeCommand
  | DuckMusicCommand
  | ApplyColorCommand
  | TrackSubjectCommand
  | CorrectTrackCommand
  | ReacquireTrackCommand
  | ClearTrackCommand
  | SetVirtualCameraCommand
  | AutoReframeCommand
  | ReplaceAssetCommand
  | GenerateVideoCommand
  | GenerateImageCommand
  | CreateVersionCommand
  | RestoreVersionCommand
  | CreateVersionFromCommand
  | DeriveVerticalVersionCommand
  | SetFadeCommand
  | RenderCommand
  | UndoCommand
  | RedoCommand
  | AppendClipCommand
  | LiftClipCommand
  | ExtractClipCommand
  | RippleTrimCommand
  | RollEditCommand
  | SlipClipCommand
  | SlideClipCommand
  | ExtendEditCommand
  | DuplicateClipCommand
  | AddMarkerCommand
  | UpdateMarkerCommand
  | RemoveMarkerCommand
  | UpdateEffectGraphCommand
  | AddEffectNodeCommand
  | RemoveEffectNodeCommand
  | UpdateEffectNodeCommand
  | ConnectEffectNodesCommand
  | DisconnectEffectNodesCommand
  | UpdateColorPipelineCommand
  | CopyColorPipelineCommand
  | PasteColorPipelineCommand
  | UpdateAudioGraphCommand

export type EditCommandResult =
  | { ok: true; command: EditCommand; warnings: string[] }
  | { ok: false; error: string; code: string }

const KIND_SET = new Set<string>(EDIT_COMMAND_KINDS)

export function isEditCommandKind(value: string): value is EditCommandKind {
  return KIND_SET.has(value)
}

export function validateEditCommandSchema(input: unknown): EditCommandResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'EditCommand must be an object.', code: 'SCHEMA' }
  }
  const rec = input as Record<string, unknown>
  if (typeof rec.id !== 'string' || !rec.id.trim()) {
    return { ok: false, error: 'EditCommand.id is required.', code: 'SCHEMA' }
  }
  if (typeof rec.kind !== 'string' || !isEditCommandKind(rec.kind)) {
    return { ok: false, error: `Unknown EditCommand kind: ${String(rec.kind)}`, code: 'SCHEMA' }
  }
  if (rec.actor !== 'human' && rec.actor !== 'ai-director' && rec.actor !== 'system') {
    return { ok: false, error: 'EditCommand.actor is invalid.', code: 'SCHEMA' }
  }
  return { ok: true, command: rec as unknown as EditCommand, warnings: [] }
}

export function newCommandId(): string {
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
