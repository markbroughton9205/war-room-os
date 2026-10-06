/**
 * Commander-facing language. Technical production terms stay internal.
 */
import type { OutputAspect } from './types'
import type {
  HvsProductionProgress,
  HvsProductionProgressStage,
  HvsProductionStepKind,
  HvsProductionStyleId,
} from './production-ai-types'

export const HVS_SUGGESTED_PROMPTS = [
  "Create a cinematic car commercial starring Ra'el.",
  'Direct a dramatic nighttime action scene.',
  'Make a funny 30-second restaurant ad.',
  'Create a luxury product commercial.',
  'Build a movie scene with two fictional actors.',
  'Create a crowd scene in a busy train station.',
  'Turn my clips into a cinematic trailer.',
] as const

export const HVS_EDITING_SUGGESTED_PROMPTS = [
  'Turn these clips into a 30-second promo.',
  'Make a cinematic trailer.',
  'Find the best moments and make a short.',
  'Clean up this video and add captions.',
  'Make this vertical for TikTok.',
  'Make three versions for social media.',
  'Make a short video from this clip.',
] as const

export function formatLabelForAspect(aspect: OutputAspect | null | undefined): string {
  if (aspect === '9:16') return 'Vertical'
  if (aspect === '1:1') return 'Square'
  return 'Widescreen'
}

export function simpleStatusLabel(status: string | null | undefined): string {
  const value = (status ?? '').toLowerCase()
  if (value === 'completed') return 'Ready to review'
  if (value === 'running' || value === 'queued') return 'Making your video'
  if (value === 'failed' || value === 'blocked') return 'Needs attention'
  if (value === 'editing') return 'In progress'
  if (value === 'draft') return 'Ready to start'
  return 'In progress'
}

export function styleLabel(id: HvsProductionStyleId | null | undefined): string {
  if (!id) return 'Natural'
  return id.charAt(0) + id.slice(1).toLowerCase()
}

export function lengthLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return 'A short cut'
  const rounded = Math.max(1, Math.round(seconds))
  return `${rounded} second${rounded === 1 ? '' : 's'}`
}

export function stepKindLabel(kind: HvsProductionStepKind): string {
  switch (kind) {
    case 'ANALYZE_MEDIA': return 'Find the strongest moments'
    case 'SELECT_MOMENTS': return 'Keep the useful sections'
    case 'BUILD_ROUGH_CUT': return 'Build the cut'
    case 'TRIM_DEAD_SPACE': return 'Remove weak or empty sections'
    case 'APPLY_TRANSITIONS': return 'Add smooth transitions'
    case 'APPLY_LOOK': return 'Improve the picture'
    case 'CLEAN_AUDIO': return 'Clean the sound'
    case 'BALANCE_AUDIO': return 'Balance voice and music'
    case 'ADD_CAPTIONS': return 'Add captions'
    case 'ADD_TITLE': return 'Add a title'
    case 'ADD_LOGO': return 'Add your logo'
    case 'ADD_VISUAL_EFFECT': return 'Add a visual effect'
    case 'CREATE_VARIANT': return 'Make another size'
    case 'FINALIZE_VIDEO': return 'Create the final video'
    default: return 'Work on your video'
  }
}

export function progressCopy(stage: HvsProductionProgressStage): Pick<HvsProductionProgress, 'headline' | 'detail'> {
  switch (stage) {
    case 'analyzing':
      return { headline: 'Analyzing your media...', detail: 'Looking through the clips you attached.' }
    case 'selecting':
      return { headline: 'Finding the strongest moments...', detail: 'Looking for the strongest usable sections.' }
    case 'building':
      return { headline: 'Building your video...', detail: 'Putting opening, middle, and ending together.' }
    case 'improving_picture':
      return { headline: 'Improving the picture...', detail: 'Applying the look you asked for.' }
    case 'cleaning_sound':
      return { headline: 'Cleaning the sound...', detail: 'Balancing voice and music.' }
    case 'adding_captions':
      return { headline: 'Adding captions...', detail: 'Writing words onto the picture.' }
    case 'preparing':
      return { headline: 'Preparing your video...', detail: 'Getting a preview ready.' }
    case 'finalizing':
      return { headline: 'Finishing your video...', detail: 'Creating the finished local file.' }
    case 'ready':
      return { headline: 'Your video is ready to review', detail: 'Take a look, then keep it or change something.' }
    case 'failed':
      return { headline: "I couldn't finish your video.", detail: 'You can try again, change the plan, or open Advanced Details.' }
    default:
      return { headline: 'Ready when you are', detail: 'Describe the video you want.' }
  }
}

export function mediaCountLine(counts: { videos: number; photos: number; audio: number }): string {
  const parts: string[] = []
  if (counts.videos) parts.push(`${counts.videos} video${counts.videos === 1 ? '' : 's'}`)
  if (counts.photos) parts.push(`${counts.photos} photo${counts.photos === 1 ? '' : 's'}`)
  if (counts.audio) parts.push(`${counts.audio} audio file${counts.audio === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : 'Nothing attached yet'
}

export function summarizeProjectMedia(assets: Array<{ kind: string }>): { videos: number; photos: number; audio: number; line: string } {
  const videos = assets.filter(asset => asset.kind === 'video').length
  const photos = assets.filter(asset => asset.kind === 'image' || asset.kind === 'graphic').length
  const audio = assets.filter(asset => asset.kind === 'audio').length
  return { videos, photos, audio, line: mediaCountLine({ videos, photos, audio }) }
}

export function durationReportLine(requestedSec: number | null | undefined, createdSec: number | null | undefined): string {
  const requested = requestedSec != null && Number.isFinite(requestedSec) ? Math.round(requestedSec * 10) / 10 : null
  const created = createdSec != null && Number.isFinite(createdSec) ? Math.round(createdSec * 10) / 10 : null
  if (requested == null && created == null) return 'Length not set yet'
  if (requested == null) return `Created: ${created} seconds`
  if (created == null) return `Requested: ${requested} seconds`
  return `Requested: ${requested} seconds · Created: ${created} seconds`
}

export function idleProgress(): HvsProductionProgress {
  const copy = progressCopy('idle')
  return {
    stage: 'idle',
    headline: copy.headline,
    detail: copy.detail,
    completed: [],
    advancedDetail: null,
    error: null,
    advancedError: null,
  }
}

export function friendlyProductionError(raw: string | null | undefined, fallback = 'I could not finish that step.'): string {
  const text = (raw ?? '').trim()
  if (!text) return fallback
  const lower = text.toLowerCase()
  if (/whisper|asr_|transcri|spoken words|speech recognition/i.test(lower)) {
    if (/unclear|no_speech|could not hear|empty|no spoken/.test(lower)) return 'Speech was too unclear for reliable captions.'
    return "I couldn't transcribe this clip."
  }
  if (/ffmpeg|filter_complex|exit code|libx264|nvenc|stderr|stack|enoent/i.test(lower)) {
    if (/audio|atempo|amix|silencedetect/i.test(lower)) return 'I could not finish the sound cleanup.'
    if (/color|eq=|lut|colorbalance/i.test(lower)) return 'I could not finish the visual look.'
    if (/overlay|xfade|blur|effect/i.test(lower)) return 'I could not finish the visual effect.'
    if (/caption|ass/i.test(lower)) return 'I could not add the captions.'
    return 'I could not finish making your video.'
  }
  if (text.length > 180) return fallback
  if (/[A-Z_]+_ERROR|TypeError|Error:/.test(text)) return fallback
  return text
}

export function looksLikeTechnicalError(raw: string | null | undefined): boolean {
  return /ffmpeg|filter_complex|exit code|libx264|stack trace|ENOENT|TypeError/i.test(raw ?? '')
}
