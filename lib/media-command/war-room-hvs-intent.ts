/**
 * Client-safe HVS routing types and intent detection.
 * No filesystem. No project mutation.
 */
import type {
  HvsProductionIntent,
  HvsProductionPlan,
  HvsProductionPlanPatch,
} from './production-ai-types'
import type { Hvs3DIntent, HvsScenePlan } from './director3d/types'
import { is3DDirectorPrompt } from './director3d/intent'
import { isDirectorFollowUp, isDirectorOrchestrationPrompt } from './director/parse'
import type { HvsDirectorPlan, HvsDirectorPlanPatch } from './director/types'
import type { HvsCameraPlanPatch, HvsCinemaIntent, HvsCinemaPlan } from './cinema-director/types'
import { isCinemaDirectorPrompt } from './cinema-director/parse'

export type HvsWarRoomRouteKind = 'none' | 'new_production' | 'revision' | 'captions' | 'variants' | 'director3d' | 'cinema' | 'actors'

export type HvsWarRoomPacket = {
  routed: boolean
  kind: HvsWarRoomRouteKind
  projectId: string | null
  conversationId: string | null
  approvalRequired: boolean
  approvalAction: 'MAKE_VIDEO' | 'APPLY_CHANGES' | 'CREATE_VERSIONS' | 'BUILD_SCENE' | 'PREVIEW' | 'BUILD_PREVIS' | null
  mutated: boolean
  intent: HvsProductionIntent | null
  plan: HvsProductionPlan | null
  patch: HvsProductionPlanPatch | null
  intent3d: Hvs3DIntent | null
  scenePlan: HvsScenePlan | null
  directorPlan: HvsDirectorPlan | null
  directorPatch: HvsDirectorPlanPatch | null
  cinemaIntent: HvsCinemaIntent | null
  cinemaPlan: HvsCinemaPlan | null
  cinemaPatch: HvsCameraPlanPatch | null
  summaryLines: string[]
  progressHint: string
}

const ACTOR_CUES = /\bra'?el\b|\bcast\b|\bactress\b|\bwebcam\b|\bbackground (people|actors|extras)\b|\bextras\b|\bcrowd\b|\bactor a\b|\bfictional woman\b|\bperformance capture\b|\btake slower\b|\bsame motion\b/i
const PRODUCTION_CUES = /\b(make|create|turn|cut|edit|produce)\b.+\b(video|clip|promo|trailer|short|reel)\b|\bmake (this|it|a) (short|vertical|30|twenty|promo)|turn this into a trailer|make a video from/i
const REVISION_CUES = /\b(stronger opening|opening shorter|shot 2|take .* out|make it (warmer|cooler|vertical|shorter)|make it \d+|add captions|captions bigger|turn the music|make a vertical|square version|20 seconds)\b/i
const CAPTION_CUES = /\badd captions?\b|\bcaptions?\b/i
const VARIANT_CUES = /\bvertical\b|\bsquare\b|\btiktok\b|\byoutube shorts\b|\banother version\b|\bcreate versions\b/i
const SPEECH_SEARCH_CUES = /\bfind where i say\b|\bgo to the part where i mention\b|\bwhere i (say|mention)\b/i

export type HvsCreateRouteKind =
  | 'EXISTING_MEDIA_PRODUCTION'
  | 'DIRECTED_SCENE'
  | 'CHARACTER_PRODUCTION'
  | '3D_PREVIS'
  | 'CINEMA_SEQUENCE'
  | 'MIXED_PRODUCTION'

const EDIT_MEDIA_CUES = /\b(turn (these|this|my) clips|from these (clips|photos)|from this clip|clean up this video|add captions|make this vertical|trailer from)\b/i
const DIRECTING_CUES = /\b(create|direct|make|build)\b.+\b(scene|commercial|ad|movie|show|trailer|sequence|spot)\b|\bdirect (an|a|this)\b/i
const MIXED_CUES = /\buse (this|these|my) (clip|clips|footage|video|photos?)\b|\bopening scene\b|\bafterward\b|\bthen use (my|this|the)\b/i
const CAST_CUES = /\bra'?el\b|\bfictional actors?\b|\bcrowd scene\b|\bbackground (actors|people|population)\b/i

/** Homepage DIRECT IT routing. Does not replace detectHvsProductionIntent. */
export function routeHvsCreateIntent(prompt: string, hasMedia: boolean): HvsCreateRouteKind {
  const text = prompt.trim()
  if (isDirectorOrchestrationPrompt(text) && hasMedia) return 'MIXED_PRODUCTION'
  if (isDirectorOrchestrationPrompt(text)) return 'DIRECTED_SCENE'
  if (hasMedia && (MIXED_CUES.test(text) || (CAST_CUES.test(text) && DIRECTING_CUES.test(text)))) return 'MIXED_PRODUCTION'
  if (isCinemaDirectorPrompt(text)) return 'CINEMA_SEQUENCE'
  if (is3DDirectorPrompt(text) && !hasMedia) return '3D_PREVIS'
  if (hasMedia && (EDIT_MEDIA_CUES.test(text) || PRODUCTION_CUES.test(text))) return 'EXISTING_MEDIA_PRODUCTION'
  if (hasMedia && is3DDirectorPrompt(text)) return 'MIXED_PRODUCTION'
  if (CAST_CUES.test(text) && !hasMedia) return 'CHARACTER_PRODUCTION'
  if (DIRECTING_CUES.test(text)) return 'DIRECTED_SCENE'
  if (hasMedia) return 'EXISTING_MEDIA_PRODUCTION'
  return 'DIRECTED_SCENE'
}

export function detectHvsProductionIntent(utterance: string, hasActiveProduction = false): HvsWarRoomRouteKind {
  const text = utterance.trim()
  if (!text) return 'none'
  const directorCameraLanguage = /24mm|orbit clockwise|dust crosses|pull the camera backward/i
  if (isDirectorOrchestrationPrompt(text) && directorCameraLanguage.test(text)) return 'director3d'
  if (ACTOR_CUES.test(text)) return 'actors'
  if (isDirectorOrchestrationPrompt(text)) return 'director3d'
  if (isCinemaDirectorPrompt(text)) return 'cinema'
  if (is3DDirectorPrompt(text)) return 'director3d'
  if (hasActiveProduction && isDirectorFollowUp(text)) return 'director3d'
  if (hasActiveProduction && CAPTION_CUES.test(text) && !PRODUCTION_CUES.test(text)) return 'captions'
  if (hasActiveProduction && SPEECH_SEARCH_CUES.test(text) && !PRODUCTION_CUES.test(text)) return 'revision'
  if (hasActiveProduction && VARIANT_CUES.test(text) && !PRODUCTION_CUES.test(text)) return 'variants'
  if (hasActiveProduction && REVISION_CUES.test(text)) return 'revision'
  if (PRODUCTION_CUES.test(text) || /\bmake a short video from these clips\b/i.test(text)) return 'new_production'
  if (hasActiveProduction && /\bmake it\b|\buse a stronger\b|\bchange\b|\badd\b/.test(text.toLowerCase())) return 'revision'
  return 'none'
}

export function isHvsApprovalUtterance(text: string): 'MAKE_VIDEO' | 'APPLY_CHANGES' | 'CREATE_VERSIONS' | 'BUILD_SCENE' | 'PREVIEW' | null {
  const value = text.trim()
  if (/^(make video|start|yes[,.]?\s*make( the)? video|approve)$/i.test(value)) return 'MAKE_VIDEO'
  if (/^(preview|use shots|yes[,.]?\s*preview)$/i.test(value)) return 'PREVIEW'
  if (/^(build scene|yes[,.]?\s*build( the)? scene|build previs)$/i.test(value)) return 'BUILD_SCENE'
  if (/^create versions$/i.test(value)) return 'CREATE_VERSIONS'
  if (/^(apply( changes)?|yes[,.]?\s*apply|keep going)$/i.test(value)) return 'APPLY_CHANGES'
  return null
}

export function emptyUnroutedPacket(): HvsWarRoomPacket {
  return {
    routed: false,
    kind: 'none',
    projectId: null,
    conversationId: null,
    approvalRequired: false,
    approvalAction: null,
    mutated: false,
    intent: null,
    plan: null,
    patch: null,
    intent3d: null,
    scenePlan: null,
    directorPlan: null,
    directorPatch: null,
    cinemaIntent: null,
    cinemaPlan: null,
    cinemaPatch: null,
    summaryLines: [],
    progressHint: '',
  }
}
