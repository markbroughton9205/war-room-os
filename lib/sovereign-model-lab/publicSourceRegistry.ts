/**
 * Registry for future intelligence collectors. Registering a source declares its intended
 * acquisition contract — it does NOT mean the source is reachable, retrieved, or training-eligible
 * yet. No network call happens in this module.
 */
import { randomUUID } from 'node:crypto'
import type { SovereignDatasetSource, SovereignDatasetSourceFamily } from './types'
import { saveSource } from './storage'

export type RegisterSourceInput = {
  family: SovereignDatasetSourceFamily
  label: string
  acquisitionMethod: string
  licenseOrTermsLocation: string
  updateFrequency: string
  supportedLanguages: string[]
  expectedContentFormat: string
  trainingEligibleByDefault: boolean
  citationRequirements: string
}

/** Registration only — sets healthStatus to 'not_checked' and lastSuccessfulRetrievalAt to null.
 * A real health probe (out of Phase 1 scope for these 11 source families) is what would ever
 * change either field; registering a source never implies it was reached. */
export function buildSourceRecord(input: RegisterSourceInput): SovereignDatasetSource {
  return {
    id: randomUUID(),
    family: input.family,
    label: input.label,
    acquisitionMethod: input.acquisitionMethod,
    licenseOrTermsLocation: input.licenseOrTermsLocation,
    updateFrequency: input.updateFrequency,
    supportedLanguages: input.supportedLanguages,
    expectedContentFormat: input.expectedContentFormat,
    trainingEligibleByDefault: input.trainingEligibleByDefault,
    citationRequirements: input.citationRequirements,
    healthStatus: 'not_checked',
    lastSuccessfulRetrievalAt: null,
    registeredAt: new Date().toISOString(),
  }
}

export async function registerSource(input: RegisterSourceInput): Promise<SovereignDatasetSource> {
  const record = buildSourceRecord(input)
  await saveSource(record)
  return record
}
