import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  isOperatorUnsafeProviderFragment,
  operatorSafeIncompleteMessage,
  validateProviderResponseIntegrity,
} from '@/lib/providers/responseIntegrity'

export type SanitizedFamilyResponse = {
  displayText: string
  integrityStatus: string
  incomplete: boolean
  operatorSafe: boolean
  label?: string
}

export function sanitizeCouncilFamilyResponse(
  family: CouncilOrchestrationFamily,
  raw: string,
): SanitizedFamilyResponse {
  const integrity = validateProviderResponseIntegrity(raw, { minLength: family === 'red_team' ? 60 : 80 })
  const incomplete = integrity.integrity_status !== 'COMPLETE'
  if (!incomplete && !isOperatorUnsafeProviderFragment(raw)) {
    return {
      displayText: raw.trim(),
      integrityStatus: integrity.integrity_status,
      incomplete: false,
      operatorSafe: true,
    }
  }
  const label =
    family === 'gemini'
      ? 'Gemini response incomplete — retry/fallback used'
      : `${family} response incomplete`
  return {
    displayText: operatorSafeIncompleteMessage(integrity.fallback_recommended ? 'fallback' : 'unavailable'),
    integrityStatus: integrity.integrity_status,
    incomplete: true,
    operatorSafe: false,
    label,
  }
}

export function councilFamilyIntegrityLabel(family: CouncilOrchestrationFamily, incomplete: boolean): string | null {
  if (!incomplete) return null
  if (family === 'gemini') return '⚠ Gemini response incomplete — excluded from synthesis'
  return `⚠ ${family} response incomplete — excluded from synthesis`
}
