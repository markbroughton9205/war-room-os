/**
 * Commander-facing War Room status. Local telemetry only.
 * Browser research is not a dependency of this brief.
 */

import type { SelfAwarenessSnapshot } from '@/lib/council/intelligence/types'
import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { GODS_EYE_CAPABILITY_ID, godsEyeCardLabel, resolveGodsEyeRuntimeState } from '@/lib/terra/godsEye/runtimeState'

function provider(awareness: SelfAwarenessSnapshot | null, id: string) {
  return awareness?.providers.find(row => row.id === id) ?? null
}

function onlineWord(healthy: boolean | null, missing: string): string {
  if (healthy === true) return 'online'
  if (healthy === false) return 'unavailable'
  return `unknown — ${missing}`
}

function councilWord(state: string | null | undefined): string {
  if (state === 'READY_LOCAL') return 'ready'
  if (state === 'READY_DEGRADED') return 'degraded'
  if (state === 'UNAVAILABLE') return 'unavailable'
  if (!state) return 'unknown — council telemetry was not returned'
  return `unknown — ${state}`
}

function localModelWord(state: string | null | undefined): string {
  if (state === 'READY_LOCAL') return 'ready'
  if (state === 'MODEL_MISSING' || state === 'UNAVAILABLE') return 'unavailable'
  if (!state) return 'unknown — local model probe was not returned'
  return 'unavailable'
}

function brokerWord(awareness: SelfAwarenessSnapshot | null): string {
  const row = provider(awareness, 'browser-broker')
  if (!row) return 'unknown — browser broker probe was not returned'
  return row.healthy ? 'ready' : 'unavailable'
}

export function formatSystemStatusCommanderBrief(awareness: SelfAwarenessSnapshot | null): string {
  const core = provider(awareness, 'core-3847')
  const ui = provider(awareness, 'ui-3848')
  const coreLabel = onlineWord(core ? core.healthy : null, 'core probe was not returned')
  const uiLabel = onlineWord(ui ? ui.healthy : null, 'UI probe was not returned')
  const councilLabel = councilWord(awareness?.council_state)
  const localLabel = localModelWord(awareness?.local_backend_state)
  const brokerLabel = brokerWord(awareness)
  const terraLabel = ui?.healthy
    ? 'connected'
    : awareness
      ? 'unknown — homepage earth runtime was not confirmed'
      : 'unknown — live Terra feed was not probed'
  const godsEye = resolveGodsEyeRuntimeState({
    registered: Boolean(lookupCapability(GODS_EYE_CAPABILITY_ID)),
  })
  const godsEyeLabel = godsEye.healthy
    ? godsEyeCardLabel(godsEye).toLowerCase()
    : godsEye.failure_reason
      ? `${godsEyeCardLabel(godsEye).toLowerCase()} — ${godsEye.failure_reason}`
      : godsEyeCardLabel(godsEye).toLowerCase()
  const foundryLabel = awareness?.install_id
    ? 'available'
    : 'unknown — no active install id in this telemetry snapshot'
  const headline = core?.healthy && ui?.healthy
    ? 'War Room is online.'
    : awareness
      ? 'War Room is not fully online.'
      : 'War Room status is waiting on local telemetry.'
  const issues: string[] = []
  if (core && !core.healthy) issues.push('Core is not responding on 3847.')
  if (ui && !ui.healthy) issues.push('UI is not responding on 3848.')
  if (awareness && councilLabel !== 'ready') issues.push(`Council is ${councilLabel}.`)
  if (awareness && localLabel !== 'ready') issues.push(`Local model is ${localLabel}.`)
  if (brokerLabel !== 'ready') issues.push(`Browser Broker is ${brokerLabel}.`)
  const lines = [
    headline,
    `- Core: ${coreLabel}`,
    `- UI: ${uiLabel}`,
    `- Council: ${councilLabel}`,
    `- Local model: ${localLabel}`,
    `- Browser Broker: ${brokerLabel}`,
    `- Terra: ${terraLabel}`,
    `- God's Eye: ${godsEyeLabel}`,
    `- Foundry: ${foundryLabel}`,
  ]
  if (issues.length) lines.push(issues[0])
  return lines.join('\n')
}
