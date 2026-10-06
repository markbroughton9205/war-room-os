import { DEFAULT_TIMESCALE, fromSeconds, toSeconds } from '../time'
import {
  cinemaId,
  cinemaSeconds,
  HVS_CINEMA_ANGLES,
  HVS_CINEMA_FRAMING,
  HVS_CINEMA_MOVEMENTS,
  HVS_CINEMA_SHOT_ROLES,
  HVS_CINEMA_SHOT_SIZES,
  HVS_LENS_MM,
  type CameraTargetRef,
  type HvsCinemaAngle,
  type HvsCinemaFraming,
  type HvsCinemaIntent,
  type HvsCinemaMovement,
  type HvsCinemaShotRole,
  type HvsCinemaShotSize,
  type HvsCinemaSkill,
  type HvsDofIntent,
  type HvsLensFamily,
  type HvsMotionSpeed,
  type HvsMovieCameraPreset,
  type HvsRelativePlacement,
  type HvsShotIntent,
} from './types'

const LENS_FAMILY_MM: Record<HvsLensFamily, number> = {
  ULTRA_WIDE: 18,
  WIDE: 24,
  NORMAL: 50,
  PORTRAIT: 85,
  TELEPHOTO: 135,
  MACRO: 100,
}

export function nearestLensMm(mm: number): number {
  return HVS_LENS_MM.reduce((best, candidate) =>
    Math.abs(candidate - mm) < Math.abs(best - mm) ? candidate : best,
  )
}

export function lensFamilyFromMm(mm: number): HvsLensFamily {
  if (mm <= 18) return 'ULTRA_WIDE'
  if (mm <= 35) return 'WIDE'
  if (mm <= 55) return 'NORMAL'
  if (mm <= 100) return 'PORTRAIT'
  return 'TELEPHOTO'
}

export function describeLensBehavior(mm: number): { perspective: 'expanded' | 'neutral' | 'compressed'; notes: string[] } {
  if (mm <= 28) {
    return {
      perspective: 'expanded',
      notes: [
        'Wide lens: more environment in frame.',
        'Stronger perspective; subject-camera proximity matters.',
        'Not a crop of a longer lens.',
      ],
    }
  }
  if (mm >= 85) {
    return {
      perspective: 'compressed',
      notes: [
        'Long lens: compressed perspective.',
        'Narrower field of view; isolates the subject.',
        'Not merely a tighter crop of a wide frame.',
      ],
    }
  }
  return { perspective: 'neutral', notes: ['Normal lens: natural perspective.'] }
}

export function isCinemaDirectorPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  if (/\bdirect in 3d\b|\b3d director\b|\b3d scene\b/.test(lower)) return false
  if (/\bdirect this scene\b|\bcinema director\b|\bcinematic sequence\b|\bshot list\b/.test(lower)) return true
  if (/\b\d{2,3}\s*mm\b|\buse a (?:14|18|24|28|35|50|65|85|100|135|200)\b/.test(lower)) return true
  if (/\b(left|right) third\b|\brack focus\b|\bpull focus\b|\bdolly zoom\b|\bhandheld (feel|style)\b/.test(lower)) return true
  if (/\bestablishing shot\b/.test(lower) && /\b(cut to|then (?:go|use|orbit)|orbit clockwise)\b/.test(lower)) return true
  return false
}

function detectDuration(prompt: string): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*-?\s*seconds?/i)
  return match ? Number(match[1]) : 8
}

function detectSkill(lower: string): HvsCinemaSkill | null {
  if (/\bdialogue|ots|over.?the.?shoulder\b/.test(lower)) return 'DIALOGUE'
  if (/\bhorror|dutch\b/.test(lower)) return 'HORROR'
  if (/\bcar commercial|product|turntable\b/.test(lower)) return 'CAR_COMMERCIAL'
  if (/\bhandheld|documentary\b/.test(lower)) return 'DOCUMENTARY'
  if (/\baction|chase|follow behind\b/.test(lower)) return 'ACTION'
  if (/\bdrone|aerial\b/.test(lower)) return 'SPORTS'
  if (/\bluxury\b/.test(lower)) return 'LUXURY'
  if (/\bmusic video\b/.test(lower)) return 'MUSIC_VIDEO'
  if (/\bcommercial\b/.test(lower)) return 'COMMERCIAL'
  return null
}

function shotSizeFromText(text: string): HvsCinemaShotSize | null {
  if (/\bextreme close-?up|ecu\b/.test(text)) return 'EXTREME_CLOSE_UP'
  if (/\bclose-?up|tight\b/.test(text)) return 'CLOSE_UP'
  if (/\binsert|macro\b/.test(text)) return 'INSERT'
  if (/\bmedium close|mcu\b/.test(text)) return 'MEDIUM_CLOSE'
  if (/\bmedium wide|full body\b/.test(text)) return 'MEDIUM_WIDE'
  if (/\bfull shot\b/.test(text)) return 'FULL'
  if (/\bextreme wide|ews\b/.test(text)) return 'EXTREME_WIDE'
  if (/\bwide|establishing\b/.test(text)) return 'WIDE'
  if (/\bmedium\b/.test(text)) return 'MEDIUM'
  return null
}

function shotRoleFromText(text: string): HvsCinemaShotRole | null {
  if (/\bestablishing\b/.test(text)) return 'ESTABLISHING'
  if (/\bmaster\b/.test(text)) return 'MASTER'
  if (/\btwo-?shot\b/.test(text)) return 'TWO_SHOT'
  if (/\bover.?the.?shoulder|ots\b/.test(text)) return 'OVER_THE_SHOULDER'
  if (/\bpov\b/.test(text)) return 'POV'
  if (/\breaction\b/.test(text)) return 'REACTION'
  if (/\bcutaway\b/.test(text)) return 'CUTAWAY'
  if (/\bhero\b/.test(text)) return 'HERO'
  if (/\bproduct\b/.test(text)) return 'PRODUCT'
  if (/\binsert|detail\b/.test(text)) return 'DETAIL'
  return null
}

function angleFromText(text: string): HvsCinemaAngle | null {
  if (/\bworm'?s.?eye\b/.test(text)) return 'WORMS_EYE'
  if (/\bbird'?s.?eye\b/.test(text)) return 'BIRDS_EYE'
  if (/\boverhead\b/.test(text)) return 'OVERHEAD'
  if (/\blow-?angle|low behind|start low\b/.test(text)) return 'LOW_ANGLE'
  if (/\bhigh-?angle\b/.test(text)) return 'HIGH_ANGLE'
  if (/\bdutch\b/.test(text)) return 'DUTCH'
  if (/\boblique\b/.test(text)) return 'OBLIQUE'
  if (/\beye.?level\b/.test(text)) return 'EYE_LEVEL'
  return null
}

function movementFromText(text: string): HvsCinemaMovement | null {
  if (/\bdolly zoom|vertigo\b/.test(text)) return 'DOLLY_ZOOM'
  if (/\bzoom in\b/.test(text)) return 'ZOOM_IN'
  if (/\bzoom out\b/.test(text)) return 'ZOOM_OUT'
  if (/\bpush (?:in|toward)|dolly in\b/.test(text)) return 'DOLLY_IN'
  if (/\bpull (?:back|out)|dolly out\b/.test(text)) return 'DOLLY_OUT'
  if (/\btruck left\b/.test(text)) return 'TRUCK_LEFT'
  if (/\btruck right\b/.test(text)) return 'TRUCK_RIGHT'
  if (/\bpedestal up\b/.test(text)) return 'PEDESTAL_UP'
  if (/\bpedestal down\b/.test(text)) return 'PEDESTAL_DOWN'
  if (/\bcrane|jib\b/.test(text)) return 'CRANE'
  if (/\borbit\b/.test(text)) return 'ORBIT'
  if (/\barc\b/.test(text)) return 'ARC'
  if (/\bwhip.?pan\b/.test(text)) return 'WHIP_PAN'
  if (/\bpan\b/.test(text)) return 'PAN'
  if (/\btilt\b/.test(text)) return 'TILT'
  if (/\bhandheld\b/.test(text)) return 'HANDHELD'
  if (/\bsteadicam\b/.test(text)) return 'STEADICAM_STYLE'
  if (/\bdrone|aerial\b/.test(text)) return 'DRONE_STYLE'
  if (/\bchase\b/.test(text)) return 'CHASE'
  if (/\blead (?:him|her|them|the)\b/.test(text)) return 'LEAD'
  if (/\bfollow behind|follow (?:him|her|them)\b/.test(text)) return 'FOLLOW'
  if (/\btrack\b/.test(text)) return 'TRACK'
  if (/\breveal\b/.test(text)) return 'REVEAL'
  if (/\bstatic|hold\b/.test(text)) return 'STATIC'
  return null
}

function framingFromText(text: string): HvsCinemaFraming | null {
  if (/\bleft (?:third|of frame)\b/.test(text)) return 'LEFT_THIRD'
  if (/\bright (?:third|of frame|side)\b/.test(text)) return 'RIGHT_THIRD'
  if (/\bsilhouette\b/.test(text)) return 'SILHOUETTE'
  if (/\blow headroom\b/.test(text)) return 'LOW_HEADROOM'
  if (/\bheadroom\b/.test(text)) return 'HEADROOM'
  if (/\blead room|look room\b/.test(text)) return 'LEAD_ROOM'
  if (/\bnegative space\b/.test(text)) return 'NEGATIVE_SPACE'
  if (/\bsymmetr/.test(text)) return 'SYMMETRICAL'
  if (/\bface lock|her face|person'?s face\b/.test(text)) return 'FACE_LOCK'
  if (/\bcenter\b/.test(text)) return 'CENTER'
  if (/\brule of thirds|thirds\b/.test(text)) return 'RULE_OF_THIRDS'
  return null
}

function relativeFromText(text: string): HvsRelativePlacement | null {
  if (/\bover.?shoulder\b/.test(text)) return 'OVER_SHOULDER'
  if (/\bfollow behind\b/.test(text)) return 'FOLLOW_BEHIND'
  if (/\bbehind\b/.test(text)) return 'BEHIND'
  if (/\bin front\b/.test(text)) return 'IN_FRONT_OF'
  if (/\bleft of\b/.test(text)) return 'LEFT_OF'
  if (/\bright of|driver'?s side\b/.test(text)) return 'RIGHT_OF'
  if (/\babove|overhead\b/.test(text)) return 'ABOVE'
  if (/\bbelow\b/.test(text)) return 'BELOW'
  return null
}

function lensFromText(text: string): { mm: number | null; family: HvsLensFamily | null } {
  const mmMatch = text.match(/\b(\d{2,3})\s*mm\b/) || text.match(/\buse a (\d{2,3})\b/)
  if (mmMatch) {
    const mm = nearestLensMm(Number(mmMatch[1]))
    return { mm, family: lensFamilyFromMm(mm) }
  }
  if (/\bultra.?wide\b/.test(text)) return { mm: LENS_FAMILY_MM.ULTRA_WIDE, family: 'ULTRA_WIDE' }
  if (/\bwide (?:cinematic )?lens|wide shot\b/.test(text)) return { mm: LENS_FAMILY_MM.WIDE, family: 'WIDE' }
  if (/\bportrait lens|longer lens\b/.test(text)) return { mm: LENS_FAMILY_MM.PORTRAIT, family: 'PORTRAIT' }
  if (/\btelephoto\b/.test(text)) return { mm: LENS_FAMILY_MM.TELEPHOTO, family: 'TELEPHOTO' }
  if (/\bmacro\b/.test(text)) return { mm: LENS_FAMILY_MM.MACRO, family: 'MACRO' }
  if (/\bnormal lens\b/.test(text)) return { mm: LENS_FAMILY_MM.NORMAL, family: 'NORMAL' }
  return { mm: null, family: null }
}

function speedFromText(text: string): HvsMotionSpeed | null {
  if (/\bvery slow\b/.test(text)) return 'VERY_SLOW'
  if (/\bslowly|slow\b/.test(text)) return 'SLOW'
  if (/\bvery fast|whip\b/.test(text)) return 'VERY_FAST'
  if (/\bfast\b/.test(text)) return 'FAST'
  return null
}

function presetFromText(text: string): HvsMovieCameraPreset | null {
  if (/\bhero low|low.?angle.*wide\b/.test(text)) return 'HERO_LOW_WIDE'
  if (/\bpush.*close-?up|slow push\b/.test(text)) return 'SLOW_PUSH_CLOSEUP'
  if (/\bots|over.?the.?shoulder\b/.test(text)) return 'OTS_DIALOGUE'
  if (/\bestablishing.*crane|crane down\b/.test(text)) return 'ESTABLISHING_CRANE'
  if (/\borbit\b/.test(text) && /\bcar\b/.test(text)) return 'CAR_COMMERCIAL_ORBIT'
  if (/\bfollow\b/.test(text) && /\baction\b/.test(text)) return 'ACTION_FOLLOW'
  if (/\bhandheld\b/.test(text)) return 'DOCUMENTARY_HANDHELD'
  if (/\bdrone\b/.test(text)) return 'DRONE_REVEAL'
  if (/\bdutch\b/.test(text)) return 'HORROR_DUTCH_PUSH'
  if (/\bmacro|insert\b/.test(text)) return 'MACRO_INSERT'
  if (/\bturntable|product\b/.test(text)) return 'PRODUCT_TURNTABLE'
  return null
}

function splitShotClauses(prompt: string): string[] {
  const sentences = prompt
    .split(/(?<=[.!?])\s+|\n+/)
    .map(item => item.trim())
    .filter(Boolean)
  const clauses: string[] = []
  for (const sentence of sentences) {
    const bits = sentence.split(/\b(?:then|cut to|start with|end on|after that)\b/i).map(item => item.trim()).filter(Boolean)
    clauses.push(...bits)
  }
  return clauses.filter(clause => {
    const lower = clause.toLowerCase()
    if (/^\d+-second cinematic sequence/.test(lower) || /^create an?\b/.test(lower) && !shotSizeFromText(lower) && !movementFromText(lower) && !lensFromText(lower).mm) {
      return /shot|camera|orbit|push|crane|lens|mm|angle|framing/.test(lower)
    }
    return Boolean(
      shotSizeFromText(lower)
      || shotRoleFromText(lower)
      || angleFromText(lower)
      || movementFromText(lower)
      || framingFromText(lower)
      || lensFromText(lower).mm
      || /\bshot\b/.test(lower),
    )
  })
}

export function parseShotIntents(prompt: string): HvsShotIntent[] {
  const clauses = splitShotClauses(prompt)
  if (!clauses.length) {
    return [{
      order: 1,
      text: prompt.trim(),
      shotSize: shotSizeFromText(prompt.toLowerCase()),
      shotRole: shotRoleFromText(prompt.toLowerCase()),
      angle: angleFromText(prompt.toLowerCase()),
      movement: movementFromText(prompt.toLowerCase()) ?? 'STATIC',
      lensMm: lensFromText(prompt.toLowerCase()).mm,
      lensFamily: lensFromText(prompt.toLowerCase()).family,
      framing: framingFromText(prompt.toLowerCase()),
      relative: relativeFromText(prompt.toLowerCase()),
      speed: speedFromText(prompt.toLowerCase()),
      preset: presetFromText(prompt.toLowerCase()),
    }]
  }
  return clauses.map((text, index) => {
    const lower = text.toLowerCase()
    const lens = lensFromText(lower)
    return {
      order: index + 1,
      text,
      shotSize: shotSizeFromText(lower),
      shotRole: shotRoleFromText(lower),
      angle: angleFromText(lower),
      movement: movementFromText(lower),
      lensMm: lens.mm,
      lensFamily: lens.family,
      framing: framingFromText(lower),
      relative: relativeFromText(lower),
      speed: speedFromText(lower),
      preset: presetFromText(lower),
    }
  })
}

export function parseDofIntent(prompt: string): HvsDofIntent | null {
  const lower = prompt.toLowerCase()
  if (/\bextreme(?:ly)? (?:shallow|blur)|rack focus|pull focus|blur the background\b/.test(lower)) return 'SHALLOW'
  if (/\bdeep (?:focus|dof)\b/.test(lower)) return 'DEEP'
  if (/\bshallow\b/.test(lower)) return 'SHALLOW'
  return null
}

export function parseFocusTargets(prompt: string, subjects: CameraTargetRef[], props: CameraTargetRef[]): {
  from: CameraTargetRef | null
  to: CameraTargetRef | null
} {
  const lower = prompt.toLowerCase()
  const car = props.find(item => /car/i.test(item.label)) ?? null
  const person = subjects.find(item => item.kind === 'PERSON') ?? null
  if (/\b(focused on|focus on) the car\b/.test(lower) && /\b(pull focus|to (her|the person|the woman))\b/.test(lower)) {
    return { from: car, to: person }
  }
  if (/\bpull focus to the (car|vehicle)\b/.test(lower)) {
    return { from: person, to: car }
  }
  if (/\bpull focus to (her|him|the person|the woman)\b/.test(lower)) {
    return { from: car, to: person }
  }
  return { from: null, to: null }
}

export function parseCinemaIntent(input: { prompt: string; projectId?: string; now?: string }): HvsCinemaIntent {
  const prompt = input.prompt.trim()
  const lower = prompt.toLowerCase()
  const subjectRefs: HvsCinemaIntent['subjectRefs'] = []
  if (/\b(person|woman|man|character|her|him|driver|people|two-?person)\b/.test(lower)) {
    subjectRefs.push({ id: 'PERSON_1', label: /\bwoman\b/.test(lower) ? 'Woman' : 'Person', kind: 'person' })
  }
  if (/\btwo-?person|ots b|person b|second person\b/.test(lower)) {
    subjectRefs.push({ id: 'PERSON_2', label: 'Person B', kind: 'person' })
  }
  const propRefs: HvsCinemaIntent['propRefs'] = []
  if (/\bcar|vehicle\b/.test(lower)) {
    propRefs.push({ id: 'CAR_1', label: 'Black car', kind: 'car', color: /\bblack\b/.test(lower) ? '#111111' : null })
  }
  const locationRefs: HvsCinemaIntent['locationRefs'] = []
  if (/\bstreet|road|city\b/.test(lower)) locationRefs.push({ id: 'STREET_1', label: 'Street', kind: 'street' })
  if (/\bbuilding|doorway\b/.test(lower)) locationRefs.push({ id: 'BUILDING_1', label: 'Building', kind: 'building' })
  const shotIntent = parseShotIntents(prompt)
  return {
    id: cinemaId('cintent'),
    projectId: input.projectId,
    prompt,
    duration: fromSeconds(detectDuration(lower), DEFAULT_TIMESCALE),
    style: /\bcinematic|dramatic|action-film\b/.test(lower) ? 'cinematic' : undefined,
    tone: /\bhorror\b/.test(lower) ? 'horror' : /\bdramatic\b/.test(lower) ? 'dramatic' : undefined,
    shotIntent,
    subjectRefs,
    locationRefs,
    propRefs,
    cameraLanguage: prompt,
    lightingIntent: /\bnight\b/.test(lower) ? 'night-cinematic' : undefined,
    continuityRequirements: /\bdialogue|ots|180\b/.test(lower) ? ['line-of-action'] : undefined,
    skill: detectSkill(lower),
    createdAt: input.now ?? new Date().toISOString(),
  }
}

export function defaultLensForSize(size: HvsCinemaShotSize): number {
  if (size === 'EXTREME_WIDE' || size === 'WIDE') return 24
  if (size === 'FULL' || size === 'MEDIUM_WIDE') return 35
  if (size === 'MEDIUM') return 50
  if (size === 'MEDIUM_CLOSE' || size === 'CLOSE_UP') return 85
  if (size === 'EXTREME_CLOSE_UP' || size === 'INSERT') return 100
  return 35
}

export function defaultSizeForLens(mm: number): HvsCinemaShotSize {
  if (mm <= 24) return 'WIDE'
  if (mm <= 35) return 'MEDIUM_WIDE'
  if (mm <= 50) return 'MEDIUM'
  if (mm <= 85) return 'CLOSE_UP'
  return 'EXTREME_CLOSE_UP'
}

export {
  HVS_CINEMA_ANGLES,
  HVS_CINEMA_FRAMING,
  HVS_CINEMA_MOVEMENTS,
  HVS_CINEMA_SHOT_ROLES,
  HVS_CINEMA_SHOT_SIZES,
  cinemaSeconds,
  toSeconds,
}
