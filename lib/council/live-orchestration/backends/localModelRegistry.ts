import type { LocalRoleSlot } from './types'

export type LocalModelHealth = 'UNKNOWN' | 'REACHABLE' | 'MODEL_MISSING' | 'UNREACHABLE'

export type LocalModelResidentPolicy = 'ALWAYS_RESIDENT' | 'SWAP_ON_DEMAND'

export type LocalModelRegistryEntry = {
  slot: LocalRoleSlot
  /** Ollama tag this would be pulled/invoked as. Resolving this entry never triggers a pull. */
  modelId: string
  repo: string
  runtime: 'ollama'
  quant: string
  roleSuitability: LocalRoleSlot[]
  residentPolicy: LocalModelResidentPolicy
  enabled: boolean
  /** Static placeholder — real health is only ever known via probeOllama() at call time. */
  health: LocalModelHealth
}

/**
 * Configuration candidates only. Nothing in this file has been downloaded, pulled, or
 * installed — see docs/architecture (War Room Council Uncensored Local Model Architecture)
 * for the research behind these picks. Genesis (RTX 5060 Ti 16GB / 32GB RAM / Ryzen 7 7700X)
 * cannot keep all of these resident simultaneously: GENERAL is the always-resident default,
 * CODING/RED_TEAM/SYNTHESIS are swap-on-demand, and RESEARCH intentionally has no dedicated
 * weight on day one (see localRegistryEntryForSlot below and disabled:false on that row) —
 * it reuses GENERAL with a research-flavored prompt, per the "not every seat needs separate
 * weights" constraint.
 */
export const LOCAL_MODEL_REGISTRY: LocalModelRegistryEntry[] = [
  {
    slot: 'GENERAL',
    modelId: 'huihui_ai/qwen3-abliterated:14b',
    repo: 'huihui-ai/Huihui-Qwen3-14B-abliterated-v2',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['GENERAL'],
    residentPolicy: 'ALWAYS_RESIDENT',
    enabled: true,
    health: 'UNKNOWN',
  },
  {
    slot: 'CODING',
    modelId: 'huihui_ai/qwen3-coder-abliterated:30b-a3b',
    repo: 'huihui-ai/Huihui-Qwen3-Coder-30B-A3B-Instruct-abliterated',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['CODING'],
    residentPolicy: 'SWAP_ON_DEMAND',
    enabled: true,
    health: 'UNKNOWN',
  },
  {
    slot: 'RED_TEAM',
    modelId: 'dolphin-mistral-venice:24b',
    repo: 'cognitivecomputations/Dolphin-Mistral-24B-Venice-Edition',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['RED_TEAM'],
    residentPolicy: 'SWAP_ON_DEMAND',
    enabled: true,
    health: 'UNKNOWN',
  },
  {
    slot: 'SYNTHESIS',
    modelId: 'huihui_ai/qwen3.5-abliterated:35b-a3b',
    repo: 'huihui-ai/Huihui-Qwen3.5-35B-A3B-abliterated',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['SYNTHESIS'],
    residentPolicy: 'SWAP_ON_DEMAND',
    enabled: true,
    health: 'UNKNOWN',
  },
  {
    slot: 'RESEARCH',
    modelId: 'huihui_ai/qwen3-abliterated:14b',
    repo: 'huihui-ai/Huihui-Qwen3-14B-abliterated-v2',
    runtime: 'ollama',
    quant: 'Q4_K_M',
    roleSuitability: ['RESEARCH', 'GENERAL'],
    residentPolicy: 'ALWAYS_RESIDENT',
    // Deliberately off until a dedicated research weight is chosen — day one shares GENERAL.
    enabled: false,
    health: 'UNKNOWN',
  },
]

export function localRegistryEntryForSlot(slot: LocalRoleSlot): LocalModelRegistryEntry | null {
  return LOCAL_MODEL_REGISTRY.find(entry => entry.slot === slot && entry.enabled) ?? null
}
