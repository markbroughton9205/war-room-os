/**
 * Council system awareness from live telemetry. Not consciousness.
 * Does not answer from stale hard-coded constants when live probes are available.
 * May try-start the user Ollama unit; never hard-codes READY.
 */

import { portInspect } from '@/lib/native-builder/portInspector'
import { installerActiveStatus } from '@/lib/native-builder/installerTool'
import { probeOllama } from '@/lib/native-builder/ollamaClient'
import { ensureLocalModelService } from '@/lib/native-builder/localModelHealth'
import { LOCAL_CORE_ORIGIN, LOCAL_UI_ORIGIN } from '@/lib/sovereign-runtime/constants'
import { LOCAL_MODEL_REGISTRY } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import { listIndexedCapabilities } from './capabilityRegistry'
import type { SelfAwarenessSnapshot } from './types'

const GENERAL = LOCAL_MODEL_REGISTRY.find(row => row.slot === 'GENERAL')?.modelId ?? 'huihui_ai/qwen3-abliterated:14b'

async function httpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function collectSelfAwareness(input: {
  missionId?: string | null
  now?: string
  bounded?: boolean
  tryStartLocal?: boolean
}): Promise<SelfAwarenessSnapshot> {
  const now = input.now ?? new Date().toISOString()
  if (input.tryStartLocal !== false) {
    await ensureLocalModelService().catch(() => ({ started: false, detail: 'start skipped' }))
  }
  const [ports, install, ollama, coreOk, uiOk, broker] = await Promise.all([
    portInspect(),
    installerActiveStatus().catch(() => null),
    probeOllama().catch(() => ({ available: false, detail: 'probe failed', models: [] as string[], baseUrl: '' })),
    httpOk(`${LOCAL_CORE_ORIGIN}/api/local/health`),
    httpOk(`${LOCAL_UI_ORIGIN}/api/health`),
    import('@/lib/browser-broker/broker').then(mod => {
      try {
        const diag = mod.getBrowserBroker().diagnostics()
        return { state: diag.brokerState, playwright: diag.playwrightAvailability }
      } catch (error) {
        return { state: 'UNAVAILABLE', playwright: error instanceof Error ? error.message : 'error' }
      }
    }).catch(() => ({ state: 'UNAVAILABLE', playwright: 'unavailable' })),
  ])

  const listeners = ports.ok ? ports.listeners : []
  const p3847 = listeners.find(row => row.port === 3847) ?? null
  const p3848 = listeners.find(row => row.port === 3848) ?? null
  const generalPresent = ollama.models.some(name => name === GENERAL || name.startsWith(`${GENERAL}`) || name.includes('qwen3-abliterated:14b'))
  const localBackend = !ollama.available
    ? 'UNAVAILABLE'
    : generalPresent
      ? 'READY_LOCAL'
      : 'MODEL_MISSING'
  const councilState = coreOk && uiOk ? (localBackend === 'READY_LOCAL' ? 'READY_LOCAL' : 'READY_DEGRADED') : 'UNAVAILABLE'
  const tools = listIndexedCapabilities().filter(item => item.council_executable).map(item => item.capability_id)

  return Object.freeze({
    install_id: install?.activeInstallId ?? null,
    runtime_3847: { pid: p3847?.pid ?? null, process: p3847?.processName ?? null, last_verified_at: now },
    runtime_3848: { pid: p3848?.pid ?? null, process: p3848?.processName ?? null, last_verified_at: now },
    council_state: councilState,
    local_backend_state: localBackend,
    general_model: generalPresent ? GENERAL : null,
    providers: [
      { id: 'core-3847', healthy: coreOk, detail: coreOk ? 'health ok' : 'health failed' },
      { id: 'ui-3848', healthy: uiOk, detail: uiOk ? 'health ok' : 'health failed' },
      { id: 'ollama', healthy: ollama.available, detail: ollama.detail },
      { id: 'local-GENERAL', healthy: generalPresent, detail: generalPresent ? GENERAL : 'GENERAL not in /api/tags' },
      { id: 'browser-broker', healthy: broker.state !== 'UNAVAILABLE' && broker.state !== 'MISCONFIGURED', detail: `${broker.state}` },
    ],
    tools_available: input.bounded ? tools.filter(id => /health|ports|backend|broker.status/.test(id)) : tools,
    evidence_board_active: true,
    mission_id: input.missionId ?? null,
    authorized: [
      'local read probes',
      'Evidence Board Council',
      'additive per-user install only when Commander-authorized via Foundry',
    ],
    requires_approval: [
      'commit',
      'push',
      'production /opt deploy',
      'spend',
      'trade',
      'wager',
      'settlement submission',
      'WRIM training',
    ],
    last_verified_at: now,
    source: 'live_telemetry',
    bounded: input.bounded === true,
  })
}
