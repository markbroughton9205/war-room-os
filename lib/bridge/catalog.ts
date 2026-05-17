import type { BridgeNodeType, BridgeRoutingRule, BridgeTrustLevel } from './types'

export const BRIDGE_NODE_PRESETS: Array<{
  nodeType: BridgeNodeType
  label: string
  defaultTrustLevel: BridgeTrustLevel
  purpose: string
}> = [
  {
    nodeType: 'commander_laptop',
    label: 'Commander Laptop',
    defaultTrustLevel: 'engineering',
    purpose: 'Primary trusted local node for approved local inference and diagnostics.',
  },
  {
    nodeType: 'engineering_node',
    label: 'Engineering Node',
    defaultTrustLevel: 'engineering',
    purpose: 'Future bounded coding and engineering task router with approval gates preserved.',
  },
  {
    nodeType: 'observer_node',
    label: 'Observer Node',
    defaultTrustLevel: 'observer',
    purpose: 'Read-only mobile or dashboard client that reports status but cannot run inference.',
  },
  {
    nodeType: 'future_gpu_node',
    label: 'Future GPU Node',
    defaultTrustLevel: 'inference',
    purpose: 'Dedicated local, remote, or VPS GPU inference machine for approved model requests.',
  },
]

export const BRIDGE_ROUTING_MODEL: BridgeRoutingRule[] = [
  {
    taskType: 'coding tasks',
    routeTo: 'Engineering Node',
    preferredNodeType: 'engineering_node',
    preferredProvider: null,
    trustRequired: 'engineering',
    notes: 'Bounded engineering requests only; no shell, filesystem mutation, deployment, or autonomous execution.',
  },
  {
    taskType: 'local reasoning',
    routeTo: 'LM Studio Node',
    preferredNodeType: 'commander_laptop',
    preferredProvider: 'lm_studio',
    trustRequired: 'inference',
    notes: 'Private local reasoning and prompt tests routed to an authenticated local inference node.',
  },
  {
    taskType: 'signal analysis',
    routeTo: 'Grok/cloud',
    preferredNodeType: 'cloud_family',
    preferredProvider: 'grok_cloud',
    trustRequired: 'observer',
    notes: 'High-volume external signal analysis remains outside the local bridge invoke surface.',
  },
  {
    taskType: 'synthesis',
    routeTo: 'ChatGPT family',
    preferredNodeType: 'cloud_family',
    preferredProvider: 'chatgpt_family',
    trustRequired: 'observer',
    notes: 'Strategic synthesis remains advisory and does not grant local node execution rights.',
  },
]

export const BRIDGE_TRUST_BOUNDARIES: Record<BridgeTrustLevel, string> = {
  observer: 'May report health and status only; no inference or engineering actions.',
  inference: 'May run approved model list, prompt test, diagnostics, health check, and bounded inference.',
  engineering: 'May receive approved engineering-scoped inference tasks, still without shell or file mutation.',
  restricted: 'Quarantined or future node class; status is visible but invokes are rejected.',
}
