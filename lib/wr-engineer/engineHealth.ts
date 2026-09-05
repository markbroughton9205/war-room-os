/**
 * WR-Engineer Phase 5 dashboard/health snapshot. Never includes API keys, credential hashes,
 * raw OLLAMA_BASE_URL with userinfo, or model weights.
 */
import {
  ALL_PROVIDER_FAMILIES,
  isProviderFamilyConfigured,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import { probeOllama, type OllamaProbeResult } from '@/lib/native-builder/ollamaClient'
import { DEFAULT_LOCAL_RUNTIME, type EngineSelection, type WrEngineerEngineDashboardState } from './engineTypes'
import { detectGpuName, genesisNodeName, getLocalEngineTelemetry, localEngineStatusFromProbe, ollamaBaseUrl, redactEngineEndpoint } from './localEngine'
import { providerHealthFromFailure, type ProviderFailureClass } from './providerFailure'

export type ExternalFailureMemory = Partial<Record<DirectProviderFamily, ProviderFailureClass>>

let lastExternalFailures: ExternalFailureMemory = {}

export function rememberExternalFailure(family: DirectProviderFamily, failure: ProviderFailureClass | undefined): void {
  if (!failure) {
    delete lastExternalFailures[family]
    return
  }
  lastExternalFailures[family] = failure
}

export function resetExternalFailureMemory(): void {
  lastExternalFailures = {}
}

export function getExternalFailureMemory(): ExternalFailureMemory {
  return { ...lastExternalFailures }
}

export type EngineHealthDeps = {
  probe?: () => Promise<OllamaProbeResult>
  gpu?: { detected: boolean; name: string }
  hostname?: string
  externalFailures?: ExternalFailureMemory
  isConfigured?: (family: DirectProviderFamily) => boolean
}

export async function buildEngineDashboardState(
  selection: EngineSelection,
  deps: EngineHealthDeps = {},
): Promise<WrEngineerEngineDashboardState> {
  const probe = await (deps.probe ?? probeOllama)()
  const localStatus = localEngineStatusFromProbe(probe, selection.localModel)
  const telemetry = getLocalEngineTelemetry()
  const gpu = deps.gpu ?? await detectGpuName()
  const hostname = deps.hostname ?? genesisNodeName()
  const failures = deps.externalFailures ?? lastExternalFailures

  const external = ALL_PROVIDER_FAMILIES
    .filter(family => family !== 'baby' && family !== 'red_team')
    .map(provider => {
      const configured = (deps.isConfigured ?? isProviderFamilyConfigured)(provider)
      return {
        provider,
        configured,
        status: providerHealthFromFailure(failures[provider] ?? null, configured),
        lastFailureClass: failures[provider],
      }
    })

  const activeEngine: WrEngineerEngineDashboardState['activeEngine'] =
    selection.mode === 'EXTERNAL' ? 'external' : localStatus === 'READY' ? 'local' : selection.mode === 'AUTO' ? 'external' : 'none'

  let engineStatus: WrEngineerEngineDashboardState['engineStatus'] = localStatus
  if (selection.mode === 'EXTERNAL') {
    const selected = external.find(row => row.provider === selection.externalFamily)
    engineStatus = selected?.status === 'RATE_LIMITED'
      ? 'EXTERNAL_RATE_LIMITED'
      : selected?.status === 'READY'
        ? 'EXTERNAL_READY'
        : 'EXTERNAL_UNAVAILABLE'
  } else if (selection.mode === 'AUTO' && localStatus !== 'READY') {
    const selected = external.find(row => row.provider === selection.externalFamily)
    engineStatus = selected?.status === 'READY' ? 'EXTERNAL_READY' : localStatus
  }

  return {
    wrEngineer: 'WR-ENGINEER',
    mode: selection.mode,
    activeEngine,
    model: selection.mode === 'EXTERNAL' ? `council_provider:${selection.externalFamily}` : selection.localModel,
    runtime: selection.mode === 'EXTERNAL' ? `council_provider:${selection.externalFamily}` : DEFAULT_LOCAL_RUNTIME,
    gpu: gpu.name,
    engineStatus,
    node: hostname,
    local: {
      runtime: DEFAULT_LOCAL_RUNTIME,
      model: selection.localModel,
      status: localStatus,
      endpoint: redactEngineEndpoint(probe.baseUrl || ollamaBaseUrl()),
      lastLatencyMs: telemetry.lastLatencyMs,
      lastError: telemetry.lastError,
    },
    external,
    fallbackAllowed: selection.mode === 'AUTO',
  }
}

export function dashboardStateIsSecretFree(state: WrEngineerEngineDashboardState): boolean {
  const blob = JSON.stringify(state).toLowerCase()
  return !blob.includes('api_key')
    && !blob.includes('sk-')
    && !blob.includes('service_role')
    && !blob.includes('authorization')
    && !blob.includes('password')
}
