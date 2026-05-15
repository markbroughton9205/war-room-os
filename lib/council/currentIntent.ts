import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import { parseCouncilCommand } from '@/lib/council/commandParser'
import { classifyIntentFromDecree, type IntentKind } from '@/lib/council/intentClassifier'
import { buildActiveScope, type ActiveScope } from '@/lib/council/intentScope'

function normalizeForFingerprint(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\u2019/g, "'")
}

/** Stable short fingerprint for decree change detection (non-cryptographic). */
export function decreeFingerprint(text: string): string {
  const n = normalizeForFingerprint(text)
  let h = 5381
  for (let i = 0; i < n.length; i++) {
    h = ((h << 5) + h) ^ n.charCodeAt(i)!
  }
  return `decree:${(h >>> 0).toString(16)}:${n.length}`
}

export function hasDecreeFingerprintChanged(prev: string | undefined, next: string): boolean {
  if (!prev) return true
  return prev !== next
}

export function hasIntentKindChanged(prev: IntentKind | undefined, next: IntentKind): boolean {
  if (!prev) return true
  return prev !== next
}

/**
 * Single source of truth: classify from **latest decree text only** (intent-first).
 * `previousIntent` is optional telemetry only — it does not override classification.
 */
export function resolveCurrentIntent(args: {
  latestRaelDecreeText: string
  /** Prior intent from client bookkeeping — informational only. */
  previousIntent?: IntentKind
}): {
  intent: IntentKind
  scope: ActiveScope
  councilCommand: CouncilCommand
  decreeFingerprint: string
} {
  void args.previousIntent
  const decreeText = typeof args.latestRaelDecreeText === 'string' ? args.latestRaelDecreeText : ''
  const councilCommand = parseCouncilCommand(decreeText)
  const intent = classifyIntentFromDecree(decreeText)
  const scope = buildActiveScope({ decreeText, councilCommand, intent })
  return {
    intent,
    scope,
    councilCommand,
    decreeFingerprint: decreeFingerprint(decreeText),
  }
}
