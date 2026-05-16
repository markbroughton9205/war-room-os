import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'
import type { ProviderIntegritySlot, RuntimeContradiction } from '@/lib/runtime/runtimeIntegrityTypes'

const GATHER_SUCCESS: ReadonlySet<ProviderFamilyOutcomeStatus> = new Set(['RESPONDED', 'DEGRADED', 'READY'])

function slotLooksNonFunctional(p: ProviderIntegritySlot): boolean {
  if (p.failed) return true
  if (!p.functional) return true
  return false
}

function councilFamilyForProviderSlotId(id: string): CouncilOrchestrationFamily | undefined {
  if (id === 'chatgpt') return 'chatgpt'
  if (id === 'claude') return 'claude'
  if (id === 'grok') return 'grok'
  if (id === 'gemini') return 'gemini'
  if (id === 'redteam') return 'red_team'
  return undefined
}

/**
 * Internal integrity-only signal: provider-health synthetic rows must not contradict
 * live engine-control probes (see `buildProviderIntegritySlots` precedence comment).
 */
export function detectProviderHintVsEngineProbeContradictions(
  providers: ProviderIntegritySlot[],
): RuntimeContradiction[] {
  const out: RuntimeContradiction[] = []
  const claude = providers.find(p => p.id === 'claude')
  const redteam = providers.find(p => p.id === 'redteam')
  if (claude?.functional && redteam && !redteam.functional && redteam.configured) {
    out.push({
      kind: 'provider_hint_vs_engine_probe',
      summary:
        'Red Team slot was inferred non-functional from credential hints while Claude engine probe reports functional (Red Team uses Claude in cloud path).',
      providerSlotId: 'redteam',
      councilFamily: 'red_team',
      integritySays: 'redteam slot non-functional / declared',
      gatherSays: 'engine_control Claude functional=true',
    })
  }
  return out
}

/**
 * When diagnostic gather shows a recent success for a council family but the integrity
 * packet still lists that engine slot as non-functional, surface an explicit contradiction
 * (does not erase either signal — Red Team may still cite both).
 */
export function detectProviderSlotVsGatherContradictions(
  providers: ProviderIntegritySlot[],
  providerRuntimeStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined,
): RuntimeContradiction[] {
  if (!providerRuntimeStates || !Object.keys(providerRuntimeStates).length) return []
  const out: RuntimeContradiction[] = []
  for (const slot of providers) {
    if (!slotLooksNonFunctional(slot)) continue
    const fam = councilFamilyForProviderSlotId(slot.id)
    if (!fam) continue
    const rt = providerRuntimeStates[fam]
    if (!rt || !GATHER_SUCCESS.has(rt)) continue
    out.push({
      kind: 'provider_slot_vs_gather_success',
      summary: `Integrity lists ${slot.id} as non-functional / degraded while current gather runtime for ${fam} is ${rt}.`,
      providerSlotId: slot.id,
      councilFamily: fam,
      integritySays: `functional=${String(slot.functional)} degraded=${String(slot.degraded)}`,
      gatherSays: rt,
    })
  }
  return out
}

export function dedupeRuntimeContradictions(items: RuntimeContradiction[]): RuntimeContradiction[] {
  const seen = new Set<string>()
  const out: RuntimeContradiction[] = []
  for (const c of items) {
    const k = `${c.kind}:${c.providerSlotId ?? ''}:${c.councilFamily ?? ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}
