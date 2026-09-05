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
    // Provenance verified 2026-09-05 via the Ollama registry manifest API (no auth required):
    //   registry.ollama.ai/v2/huihui_ai/qwen3-abliterated/manifests/14b
    //   registry.ollama.ai/v2/huihui_ai/qwen3-abliterated/manifests/14b-v2
    // Both return an IDENTICAL model-layer digest (sha256:25bb9ad6ab7dfe4b5fcff944facdf09e3a
    // 035a7d04dcf6e2de5f566e102efec8, 9,001,748,832 bytes) — so Ollama's own registry confirms
    // the plain "14b" tag being pulled here IS byte-identical to what Ollama itself labels
    // "14b-v2". The manifest's license layer resolves to Apache-2.0. What is NOT independently
    // confirmed: which specific Hugging Face repo this was converted from — Ollama's library
    // page (ollama.com/huihui_ai/qwen3-abliterated) attributes it only to the generic
    // "Qwen/qwen3" base collection, never a named huihui-ai HF repo path. The previous `repo`
    // value here (huihui-ai/Huihui-Qwen3-14B-abliterated-v2) was an assumption, not a verified
    // fact, so `repo` below points at the actually-verified Ollama source instead of guessing
    // an unconfirmed HF repo string. Do not "upgrade" this to a specific HF repo path without
    // the same kind of independent verification performed here.
    slot: 'GENERAL',
    modelId: 'huihui_ai/qwen3-abliterated:14b',
    repo: 'ollama.com/huihui_ai/qwen3-abliterated',
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
    // Mirrors GENERAL's modelId/repo (see the provenance note on that entry) — mechanically
    // consistent since RESEARCH reuses GENERAL's weight by design, not a separately-verified claim.
    slot: 'RESEARCH',
    modelId: 'huihui_ai/qwen3-abliterated:14b',
    repo: 'ollama.com/huihui_ai/qwen3-abliterated',
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
