import { fromSeconds, DEFAULT_TIMESCALE } from '../time'
import { nid, type Hvs3DIntent, type HvsCameraMotionPreset } from './types'

function detectDuration(prompt: string): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*-?\s*seconds?/i)
  if (match) return Number(match[1])
  return 8
}

function presetsFromPrompt(lower: string): HvsCameraMotionPreset[] {
  const out: HvsCameraMotionPreset[] = []
  if (/\borbit|circle around|circling\b/.test(lower)) out.push('ORBIT')
  if (/\bpush in|close-?up|closer to (her|his|their) face|tighter\b/.test(lower)) out.push('PUSH_IN')
  if (/\blow (angle|behind|rear)|behind the car|reveal\b/.test(lower)) out.push('REVEAL')
  if (/\bfollow behind|follow (her|him|them)\b/.test(lower)) out.push('FOLLOW')
  if (/\boverhead|descend|crane\b/.test(lower)) out.push('CRANE')
  if (/\bpan\b/.test(lower)) out.push('PAN')
  if (/\btilt\b/.test(lower)) out.push('TILT')
  if (/\bdolly\b/.test(lower)) out.push('DOLLY')
  if (!out.length) out.push('CUSTOM_PATH')
  return out
}

export function parse3DIntent(input: { prompt: string; projectId: string; now?: string }): Hvs3DIntent {
  const prompt = input.prompt.trim()
  const lower = prompt.toLowerCase()
  const durationSec = detectDuration(lower)
  const subjects: Hvs3DIntent['subjects'] = []
  if (/\b(woman|person|man|character|figure|someone)\b/.test(lower)) {
    subjects.push({ kind: 'person', label: /\bwoman\b/.test(lower) ? 'Woman' : 'Person' })
  }
  const props: Hvs3DIntent['props'] = []
  if (/\bcar|vehicle|sports car\b/.test(lower)) {
    props.push({ kind: 'car', label: 'Sports car', color: /\bblack\b/.test(lower) ? '#111111' : null })
  }
  if (/\bbuilding|doorway|door|alley\b/.test(lower)) {
    props.push({ kind: 'building', label: 'Building' })
  }
  let timeOfDay: Hvs3DIntent['timeOfDay'] = null
  if (/\bnight|nighttime\b/.test(lower)) timeOfDay = 'night'
  else if (/\bdaytime|daylight|day\b/.test(lower)) timeOfDay = 'day'
  else if (/\bdawn\b/.test(lower)) timeOfDay = 'dawn'
  else if (/\bdusk|sunset\b/.test(lower)) timeOfDay = 'dusk'

  return {
    id: nid('intent3d'),
    projectId: input.projectId,
    prompt,
    sceneType: /\bcity|street|alley\b/.test(lower) ? 'city-night' : 'generic',
    duration: fromSeconds(durationSec, DEFAULT_TIMESCALE),
    style: /\bcinematic|moody\b/.test(lower) ? 'cinematic' : null,
    environment: timeOfDay === 'night' ? 'night' : timeOfDay === 'day' ? 'day' : null,
    timeOfDay,
    subjects,
    props,
    cameraIntent: presetsFromPrompt(lower),
    subjectMotion: /\bwalk|walks|walking\b/.test(lower) ? 'walk-to-door' : null,
    cameraMotion: lower,
    lightingIntent: /\bnight|moody|cinematic\b/.test(lower) ? 'night-cinematic' : null,
    framingIntent: /\bclose-?up|face\b/.test(lower) ? 'FACE_LOCK' : 'CINEMATIC_FOLLOW',
    constraints: [],
    createdAt: input.now ?? new Date().toISOString(),
  }
}

export function is3DDirectorPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  if (/\bdirect in 3d\b|\b3d director\b|\b3d scene\b/.test(lower)) return true
  const spatial = /\b(orbit|circle around|push in|close-up|camera low|behind the car|walk toward)\b/.test(lower)
  const subjects = /\b(car|person|woman|building|street|alley)\b/.test(lower)
  return spatial && subjects
}
