import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_ROUTING_MODES, type CouncilRoutingMode, type SeatBackendPolicy } from './types'

const DEFAULT_MODE: CouncilRoutingMode = 'EXTERNAL_ONLY'

/**
 * Production-safe by construction. Nothing changes unless an operator explicitly sets
 * COUNCIL_ROUTING_MODE in their environment — there is no other code path that can select a
 * mode other than EXTERNAL_ONLY, and EXTERNAL_ONLY is a pure pass-through to the pre-existing
 * external-only Council behavior (see externalBackend.ts / seatRouter.ts).
 */
export function resolveCouncilRoutingMode(): CouncilRoutingMode {
  const raw = process.env.COUNCIL_ROUTING_MODE?.trim().toUpperCase()
  if (raw && (COUNCIL_ROUTING_MODES as string[]).includes(raw)) return raw as CouncilRoutingMode
  return DEFAULT_MODE
}

/**
 * Cloud API-key presence is backend availability, not Nebula agent eligibility.
 * LOCAL_FIRST / LOCAL_ONLY / HYBRID must keep ASTRA-selected seats on the floor
 * so invokeCouncilSeat can route them to Ollama before any external fallback.
 */
export function localRoutingBypassesCloudFloorGate(): boolean {
  return resolveCouncilRoutingMode() !== 'EXTERNAL_ONLY'
}

/**
 * Default per-seat policy consulted only under HYBRID. grok/gemini favor EXTERNAL_FIRST because
 * their Council role depends on live grounding/current signal that local weights don't have;
 * red_team is pinned LOCAL_ONLY for maximum candor with no external logging; the rest default
 * to LOCAL_FIRST. Commander-editable via COUNCIL_SEAT_BACKEND_POLICY (JSON, e.g.
 * {"red_team":"LOCAL_ONLY","grok":"EXTERNAL_FIRST"}) — unrecognized/invalid entries are ignored.
 */
const DEFAULT_HYBRID_SEAT_POLICY: Record<CouncilOrchestrationFamily, SeatBackendPolicy> = {
  claude: 'LOCAL_FIRST',
  chatgpt: 'LOCAL_FIRST',
  baby: 'LOCAL_FIRST',
  kimi: 'LOCAL_FIRST',
  bridge_architect: 'LOCAL_FIRST',
  red_team: 'LOCAL_ONLY',
  grok: 'EXTERNAL_FIRST',
  gemini: 'EXTERNAL_FIRST',
}

const SEAT_BACKEND_POLICIES: SeatBackendPolicy[] = ['LOCAL_ONLY', 'LOCAL_FIRST', 'EXTERNAL_FIRST', 'EXTERNAL_ONLY']

function parseSeatPolicyOverrides(): Partial<Record<CouncilOrchestrationFamily, SeatBackendPolicy>> {
  const raw = process.env.COUNCIL_SEAT_BACKEND_POLICY?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    const overrides: Partial<Record<CouncilOrchestrationFamily, SeatBackendPolicy>> = {}
    for (const [seat, policy] of Object.entries(parsed)) {
      if ((SEAT_BACKEND_POLICIES as string[]).includes(policy)) {
        overrides[seat as CouncilOrchestrationFamily] = policy as SeatBackendPolicy
      }
    }
    return overrides
  } catch {
    return {}
  }
}

export function resolveSeatBackendPolicy(seat: CouncilOrchestrationFamily): SeatBackendPolicy {
  const overrides = parseSeatPolicyOverrides()
  return overrides[seat] ?? DEFAULT_HYBRID_SEAT_POLICY[seat] ?? 'LOCAL_FIRST'
}
