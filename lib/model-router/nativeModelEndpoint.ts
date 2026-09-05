// AGI Wave 2 (Phase 37) — the next practical serving contract for a future native WRIM/Ra'el
// inference endpoint. Descriptive only: no code path in this repo constructs or calls a real
// NativeModelEndpoint, and this file does NOT import anything from scripts/sovereign-model-lab.
// WRIM-1 is not trained here; WRIM-0 remains untouched; no imported model is relabeled as Ra'el.

export type NativeModelEndpoint = {
  checkpointId: string
  tokenizerId: string
  contextLimit: number
  supportsStreaming: boolean
  supportsTools: boolean
  capabilities: readonly string[]
  latencyMetadata: { p50Ms: number | null; p95Ms: number | null; measuredAt: string | null }
  /** Always 'experimental' in Wave 2 — no endpoint is ever default-routed. */
  status: 'experimental' | 'candidate' | 'active'
}

/** The only instance of this contract in Wave 2 — descriptive metadata about WRIM-0's shape as a
 * future serving target, never invoked, never wired into lib/model-router/dispatch.ts or any
 * chat path. Populate real values only when an actual serving adapter exists (Wave 3+). */
export const WRIM0_NATIVE_ENDPOINT_PLACEHOLDER: NativeModelEndpoint = {
  checkpointId: 'wrim0-genesis-unset',
  tokenizerId: 'wr-tokenizer-0',
  contextLimit: 0,
  supportsStreaming: false,
  supportsTools: false,
  capabilities: [],
  latencyMetadata: { p50Ms: null, p95Ms: null, measuredAt: null },
  status: 'experimental',
}
