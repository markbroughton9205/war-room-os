/**
 * God's Eye runtime state. Extends the existing Terra / God's Eye stack.
 * Does not invent satellite, telemetry, or sensor observations.
 * Required base capabilities are the in-process registry, open stack, and Terra link.
 * Optional live feeds keep their real coverage states and do not upgrade a gap to HEALTHY.
 */
import {
  CLICK_INFO_STATUS,
  GODS_EYE_OPEN_STACK_FOUNDATION,
  GODS_EYE_OPEN_STACK_REPLACES_TERRA,
  LIVE_SIGNAL_PHASE_STATUS,
  STREET_NAMES_STATUS,
  STREET_OBJECT_INTERFACE_STATUS,
  godsEyeOpenStackReport,
} from '@/lib/terra/godsEye/openStack'
import { GODS_EYE_LAYER_REGISTRY } from '@/lib/terra/godsEye/layerRegistry'

export const GODS_EYE_CAPABILITY_ID = 'terra.gods_eye' as const

export const GODS_EYE_RUNTIME_STATUSES = ['HEALTHY', 'DEGRADED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISCONFIGURED'] as const
export type GodsEyeRuntimeStatus = (typeof GODS_EYE_RUNTIME_STATUSES)[number]

export type GodsEyeCapabilityTruth = {
  id: string
  required: boolean
  responding: boolean
  state: string
}

export type GodsEyeRuntimeState = {
  status: GodsEyeRuntimeStatus
  configured: boolean
  registered: boolean
  healthy: boolean
  runtime_owner: string
  terra_linked: boolean
  capabilities: GodsEyeCapabilityTruth[]
  data_sources: string[]
  capability_count: number
  last_health_check: string
  failure_reason: string | null
  degraded_reason: string | null
}

export type GodsEyeRuntimeInput = {
  registered?: boolean
  force?: string | null
  now?: string
}

function forceValue(input?: GodsEyeRuntimeInput): string | null {
  const raw = input?.force ?? process.env.WAR_ROOM_GODS_EYE_FORCE ?? null
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return value || null
}

export function godsEyeCapabilityResponses(): GodsEyeCapabilityTruth[] {
  const report = godsEyeOpenStackReport()
  const registryResponding = GODS_EYE_LAYER_REGISTRY.length > 0
  return [
    {
      id: 'open_stack',
      required: true,
      responding: report.foundation === GODS_EYE_OPEN_STACK_FOUNDATION && report.engine === 'CESIUMJS',
      state: report.foundation,
    },
    {
      id: 'layer_registry',
      required: true,
      responding: registryResponding,
      state: registryResponding ? `layers:${GODS_EYE_LAYER_REGISTRY.length}` : 'empty',
    },
    {
      id: 'terra_link',
      required: true,
      responding: GODS_EYE_OPEN_STACK_REPLACES_TERRA === false,
      state: GODS_EYE_OPEN_STACK_REPLACES_TERRA ? 'replaces_terra' : 'terra_linked',
    },
    {
      id: 'click_info',
      required: true,
      responding: CLICK_INFO_STATUS === 'ACTIVE',
      state: CLICK_INFO_STATUS,
    },
    {
      id: 'street_names',
      required: true,
      responding: STREET_NAMES_STATUS === 'ACTIVE',
      state: STREET_NAMES_STATUS,
    },
    {
      id: 'street_objects',
      required: true,
      responding: STREET_OBJECT_INTERFACE_STATUS === 'ACTIVE',
      state: STREET_OBJECT_INTERFACE_STATUS,
    },
    {
      id: 'live_signal_phase',
      required: false,
      responding: LIVE_SIGNAL_PHASE_STATUS === 'ACTIVE',
      state: LIVE_SIGNAL_PHASE_STATUS,
    },
  ]
}

export function resolveGodsEyeRuntimeState(input: GodsEyeRuntimeInput = {}): GodsEyeRuntimeState {
  const now = input.now ?? new Date().toISOString()
  const capabilities = godsEyeCapabilityResponses()
  const required = capabilities.filter(row => row.required)
  const requiredOk = required.every(row => row.responding)
  const registered = input.registered === true
  const terraLinked = capabilities.find(row => row.id === 'terra_link')?.responding === true
  const configured = requiredOk
  const force = forceValue(input)
  const base = {
    runtime_owner: 'terra',
    terra_linked: terraLinked,
    capabilities,
    data_sources: ['terra-open-stack', 'gods-eye-layer-registry'],
    capability_count: capabilities.length,
    last_health_check: now,
  }

  if (force === 'unconfigured' || force === 'not_configured') {
    return {
      ...base,
      status: 'NOT_CONFIGURED',
      configured: false,
      registered,
      healthy: false,
      failure_reason: 'controlled gods eye not-configured fixture',
      degraded_reason: null,
    }
  }
  if (force === 'degraded') {
    return {
      ...base,
      status: 'DEGRADED',
      configured: true,
      registered,
      healthy: false,
      failure_reason: null,
      degraded_reason: 'controlled gods eye degraded fixture',
    }
  }
  if (force === 'unavailable') {
    return {
      ...base,
      status: 'UNAVAILABLE',
      configured: false,
      registered,
      healthy: false,
      terra_linked: false,
      failure_reason: 'controlled gods eye unavailable fixture',
      degraded_reason: null,
    }
  }

  if (!registered) {
    return {
      ...base,
      status: 'MISCONFIGURED',
      configured,
      registered: false,
      healthy: false,
      failure_reason: 'God\'s Eye capability is not registered',
      degraded_reason: null,
    }
  }
  if (!requiredOk || !terraLinked) {
    return {
      ...base,
      status: configured ? 'DEGRADED' : 'NOT_CONFIGURED',
      configured,
      registered: true,
      healthy: false,
      failure_reason: configured ? null : 'required God\'s Eye base capabilities did not respond',
      degraded_reason: configured ? 'a required God\'s Eye capability did not respond' : null,
    }
  }
  return {
    ...base,
    status: 'HEALTHY',
    configured: true,
    registered: true,
    healthy: true,
    failure_reason: null,
    degraded_reason: null,
  }
}

/** Homepage card label. Absence of a producer stays NOT CONFIGURED. */
export function godsEyeCardLabel(state: GodsEyeRuntimeState | null | undefined): string {
  if (!state) return "GOD'S EYE CHECKING"
  if (state.status === 'HEALTHY' && state.configured && state.registered && state.healthy && state.terra_linked) return "GOD'S EYE ACTIVE"
  if (state.status === 'DEGRADED') return "GOD'S EYE DEGRADED"
  if (state.status === 'UNAVAILABLE') return "GOD'S EYE OFFLINE"
  if (state.status === 'MISCONFIGURED') return "GOD'S EYE MISCONFIGURED"
  return "GOD'S EYE NOT CONFIGURED"
}
