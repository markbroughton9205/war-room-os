import { shortId } from './hash'
import type {
  Aabb,
  HvsCinematicStrength,
  HvsDestructionClass,
  HvsDestructionIntent,
  HvsDestructionMode,
  HvsDestructionRegionId,
  HvsMaterialId,
  HvsPerformanceTier,
  Vec3,
} from './types'

const FRONT = { x: 0, y: -0.15, z: 1 }

function includes(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase)
}

function regionBox(region: HvsDestructionRegionId): Aabb {
  if (region === 'LEFT') return { min: { x: -3, y: 0, z: -0.3 }, max: { x: -0.6, y: 3, z: 0.3 } }
  if (region === 'RIGHT') return { min: { x: 1.6, y: 0, z: -0.3 }, max: { x: 3, y: 3, z: 0.3 } }
  if (region === 'WINDOWS') return { min: { x: -3, y: 1.6, z: -0.3 }, max: { x: 3, y: 3, z: 0.3 } }
  return { min: { x: -3, y: 0, z: -0.3 }, max: { x: 3, y: 3, z: 0.3 } }
}

function destructionClass(prompt: string): HvsDestructionClass {
  if (includes(prompt, 'facade')) return 'FACADE'
  if (includes(prompt, 'room')) return 'ROOM'
  if (includes(prompt, 'vehicle') || includes(prompt, 'panel')) return 'VEHICLE_PANEL'
  if (includes(prompt, 'prop')) return 'PROP'
  if (includes(prompt, 'wall')) return 'WALL'
  return 'OTHER'
}

function tier(prompt: string): HvsPerformanceTier {
  if (includes(prompt, 'city block') || includes(prompt, 'city-block') || includes(prompt, 'whole city')) return 'LARGE'
  if (includes(prompt, 'medium tier') || includes(prompt, 'several buildings')) return 'MEDIUM'
  return 'SMALL'
}

function mode(prompt: string): HvsDestructionMode {
  if (includes(prompt, 'physics only') || includes(prompt, 'physics-led')) return 'PHYSICS_LED'
  if (includes(prompt, 'guided only')) return 'GUIDED'
  return 'HYBRID'
}

function materialFromPrompt(prompt: string): HvsMaterialId {
  const pairs: Array<[string, HvsMaterialId]> = [
    ['glass', 'GLASS'],
    ['window', 'GLASS'],
    ['brick', 'BRICK'],
    ['wood', 'WOOD'],
    ['metal', 'METAL'],
    ['drywall', 'DRYWALL'],
    ['stone', 'STONE'],
    ['concrete', 'CONCRETE'],
  ]
  for (const [phrase, id] of pairs) {
    if (includes(prompt, phrase)) return id
  }
  return 'CONCRETE'
}

function direction(prompt: string): Vec3 {
  if (includes(prompt, 'left')) return { x: -0.35, y: -0.2, z: 0.9 }
  if (includes(prompt, 'right')) return { x: 0.35, y: -0.2, z: 0.9 }
  return { ...FRONT }
}

export function parseDestructionIntent(input: {
  prompt: string
  projectId?: string | null
  sceneId?: string | null
  targetRefs?: string[]
  now?: string
}): HvsDestructionIntent {
  const prompt = input.prompt.trim()
  const performanceTier = tier(prompt)
  const protectedRegions: HvsDestructionRegionId[] = []
  if (includes(prompt, 'right support') || includes(prompt, 'right column') || includes(prompt, 'right side standing') || includes(prompt, 'keep the right')) {
    protectedRegions.push('RIGHT')
  }
  const collapseRegion: HvsDestructionRegionId | null = includes(prompt, 'left')
    ? 'LEFT'
    : includes(prompt, 'window')
      ? 'WINDOWS'
      : includes(prompt, 'front') || includes(prompt, 'wall')
        ? 'FRONT'
        : null
  const severity = includes(prompt, 'harder') ? 0.9 : includes(prompt, 'slower') ? 0.45 : 0.72
  const durationSec = includes(prompt, 'slower') ? 7 : 5
  return {
    id: shortId('dint', { prompt, projectId: input.projectId ?? null, sceneId: input.sceneId ?? null }),
    projectId: input.projectId ?? null,
    sceneId: input.sceneId ?? 'scene-destruction',
    targetAssetIds: input.targetRefs ?? [],
    targetNodeIds: [],
    description: prompt,
    destructionClass: destructionClass(prompt),
    severity: Math.min(1, Math.max(0, severity)),
    mode: mode(prompt),
    durationSec,
    directionHint: direction(prompt),
    impactRegion: collapseRegion ? regionBox(collapseRegion) : regionBox('FRONT'),
    collapseRegion,
    protectedRegions,
    materialOverrides: { FULL: materialFromPrompt(prompt) },
    performanceTier,
    outputIntent: 'PREVIS_ONLY',
    operationalSupport: performanceTier === 'SMALL',
    cinematicForceOnly: true,
    createdAt: input.now ?? new Date().toISOString(),
  }
}

export function validateDestructionIntent(intent: HvsDestructionIntent): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!intent.id) errors.push('id')
  if (!intent.description.trim()) errors.push('description')
  if (!(intent.severity >= 0 && intent.severity <= 1)) errors.push('severity')
  if (!['WALL', 'FACADE', 'ROOM', 'PROP', 'VEHICLE_PANEL', 'OTHER'].includes(intent.destructionClass)) errors.push('class')
  if (!['PHYSICS_LED', 'GUIDED', 'HYBRID'].includes(intent.mode)) errors.push('mode')
  if (!['SMALL', 'MEDIUM', 'LARGE'].includes(intent.performanceTier)) errors.push('tier')
  if (intent.durationSec <= 0 || intent.durationSec > 30) errors.push('duration')
  if (intent.cinematicForceOnly !== true) errors.push('cinematic')
  return { ok: errors.length === 0, errors }
}

export function impulseClassForSeverity(severity: number): HvsCinematicStrength {
  if (severity >= 0.8) return 'STRONG'
  if (severity >= 0.5) return 'MODERATE'
  return 'GENTLE'
}
