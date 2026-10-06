import type { HvsCinematicStrength, HvsMaterialId } from './types'

/**
 * Cinematic simulation presets. These are not certified structural properties
 * and must not be used as engineering, demolition, or blast data.
 */
export type HvsMaterialPreset = {
  id: HvsMaterialId
  densityClass: 'LIGHT' | 'MEDIUM' | 'HEAVY'
  fracturePattern: 'BRITTLE_SHATTER' | 'BLOCKY' | 'SPLINTER' | 'SHEET' | 'GENERIC'
  constraintStrengthClass: HvsCinematicStrength
  debrisClass: 'FINE' | 'CHUNKY' | 'SHARD' | 'SPLINTER'
  dustClass: 'NONE' | 'LIGHT' | 'HEAVY'
  audioMaterialClass: 'concrete' | 'brick' | 'glass' | 'wood' | 'metal' | 'drywall' | 'stone' | 'generic'
  /** Relative cinematic mass factor. Not a measured kg/m3 engineering density. */
  cinematicMassFactor: number
  certifiedEngineeringData: false
}

export const HVS_MATERIAL_PRESETS: Record<HvsMaterialId, HvsMaterialPreset> = {
  CONCRETE: { id: 'CONCRETE', densityClass: 'HEAVY', fracturePattern: 'BLOCKY', constraintStrengthClass: 'STRONG', debrisClass: 'CHUNKY', dustClass: 'HEAVY', audioMaterialClass: 'concrete', cinematicMassFactor: 1.4, certifiedEngineeringData: false },
  BRICK: { id: 'BRICK', densityClass: 'HEAVY', fracturePattern: 'BLOCKY', constraintStrengthClass: 'MODERATE', debrisClass: 'CHUNKY', dustClass: 'HEAVY', audioMaterialClass: 'brick', cinematicMassFactor: 1.2, certifiedEngineeringData: false },
  GLASS: { id: 'GLASS', densityClass: 'MEDIUM', fracturePattern: 'BRITTLE_SHATTER', constraintStrengthClass: 'GENTLE', debrisClass: 'SHARD', dustClass: 'NONE', audioMaterialClass: 'glass', cinematicMassFactor: 0.6, certifiedEngineeringData: false },
  WOOD: { id: 'WOOD', densityClass: 'LIGHT', fracturePattern: 'SPLINTER', constraintStrengthClass: 'MODERATE', debrisClass: 'SPLINTER', dustClass: 'LIGHT', audioMaterialClass: 'wood', cinematicMassFactor: 0.45, certifiedEngineeringData: false },
  METAL: { id: 'METAL', densityClass: 'HEAVY', fracturePattern: 'SHEET', constraintStrengthClass: 'STRONG', debrisClass: 'SHARD', dustClass: 'NONE', audioMaterialClass: 'metal', cinematicMassFactor: 2.1, certifiedEngineeringData: false },
  DRYWALL: { id: 'DRYWALL', densityClass: 'LIGHT', fracturePattern: 'SHEET', constraintStrengthClass: 'GENTLE', debrisClass: 'FINE', dustClass: 'HEAVY', audioMaterialClass: 'drywall', cinematicMassFactor: 0.25, certifiedEngineeringData: false },
  STONE: { id: 'STONE', densityClass: 'HEAVY', fracturePattern: 'BLOCKY', constraintStrengthClass: 'STRONG', debrisClass: 'CHUNKY', dustClass: 'HEAVY', audioMaterialClass: 'stone', cinematicMassFactor: 1.5, certifiedEngineeringData: false },
  GENERIC: { id: 'GENERIC', densityClass: 'MEDIUM', fracturePattern: 'GENERIC', constraintStrengthClass: 'MODERATE', debrisClass: 'CHUNKY', dustClass: 'LIGHT', audioMaterialClass: 'generic', cinematicMassFactor: 1, certifiedEngineeringData: false },
}

export const HVS_MATERIAL_IDS = Object.keys(HVS_MATERIAL_PRESETS) as HvsMaterialId[]

export function materialPreset(id: HvsMaterialId): HvsMaterialPreset {
  return HVS_MATERIAL_PRESETS[id]
}

export function cinematicMass(volumeM3: number, materialId: HvsMaterialId): number {
  return Math.max(0.05, volumeM3 * materialPreset(materialId).cinematicMassFactor)
}
