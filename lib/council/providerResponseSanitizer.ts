import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { applyCouncilRenderGate } from '@/lib/council/councilRenderGate'
import { detectPromptIntent, type PromptIntent } from '@/lib/council/promptIntent'
import { toDisplayText } from '@/lib/council/toDisplayText'

export type SanitizedFamilyResponse = {
  displayText: string
  integrityStatus: string
  incomplete: boolean
  operatorSafe: boolean
  label?: string
}

export function sanitizeCouncilFamilyResponse(
  family: CouncilOrchestrationFamily,
  raw: unknown,
  opts?: { decreeText?: string; promptIntent?: PromptIntent },
): SanitizedFamilyResponse {
  const text = toDisplayText(raw)
  const promptIntent = opts?.promptIntent ?? (opts?.decreeText ? detectPromptIntent(opts.decreeText) : undefined)
  const gate = applyCouncilRenderGate(family, text, { councilMode: true, promptIntent, decreeText: opts?.decreeText })
  const incomplete = !gate.renderable || gate.degraded

  if (!incomplete) {
    return {
      displayText: gate.displayText,
      integrityStatus: gate.integrityStatus,
      incomplete: false,
      operatorSafe: true,
    }
  }

  const label =
    family === 'gemini'
      ? 'Gemini response incomplete — excluded from synthesis'
      : `${family} response incomplete — excluded from synthesis`

  return {
    displayText: gate.displayText,
    integrityStatus: gate.integrityStatus,
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
