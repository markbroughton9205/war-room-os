import type {
  EvidenceConfidenceTier,
  EvidenceFreshness,
  EvidenceOriginType,
  IntelligenceEvidenceItem,
} from '@/lib/intelligence/intelligencePacket'

/**
 * Foundation constructors for the non-LIVE_WEB evidence origins introduced in Build #4A.
 *
 * `normalizeSourceEvidence` (lib/intelligence/sourceNormalizer.ts) is the one live producer of
 * `IntelligenceEvidenceItem` today, and it only ever tags `origin_type: 'LIVE_WEB'` — that is the
 * only origin with a real evidence-shaped source feeding it right now. Terra globe context and
 * runtime/provider status exist in the live app, but today they travel as plain prompt text
 * (`app/page.tsx`'s `[CURRENT TERRA CONTEXT ...]` block) or as the separate, differently-shaped
 * `VerifiedRuntimeContext` (lib/council/runtimeTruth.ts) — neither is currently constructed as an
 * `IntelligenceEvidenceItem`. These factories exist so a future call site can adopt the origin
 * taxonomy correctly and consistently the moment it starts producing real evidence items for these
 * origins, without inventing its own field shape. They are not wired into a live path yet — doing so
 * without a genuine evidence-shaped source at the call site would be exactly the fabricated-origin
 * outcome Build #4A explicitly prohibits for KIMI_WAVE/STORED_RESEARCH.
 */

type BaseEvidenceArgs = {
  id: string
  source_id: string
  source_label: string
  title: string
  claim: string
  content: string
  observed_at: string
  url?: string
  confidence?: number
  confidence_tier?: EvidenceConfidenceTier
  freshness?: EvidenceFreshness
}

function baseEvidenceItem(
  args: BaseEvidenceArgs,
  originType: EvidenceOriginType,
  sourceType: IntelligenceEvidenceItem['source_type'],
  verifiedLevel: IntelligenceEvidenceItem['verified_level'],
): IntelligenceEvidenceItem {
  return {
    id: args.id,
    source_id: args.source_id,
    source_type: sourceType,
    source_label: args.source_label,
    verified_level: verifiedLevel,
    title: args.title,
    ...(args.url ? { url: args.url } : {}),
    claim: args.claim,
    content: args.content,
    observed_at: args.observed_at,
    confidence: args.confidence ?? 0,
    confidence_tier: args.confidence_tier ?? 'unsupported',
    corroboration_count: 0,
    freshness: args.freshness ?? 'unknown',
    source_reputation: 0,
    contradiction_flags: [],
    evidence_density: 0,
    related_evidence_links: [],
    weak_signal: false,
    origin_type: originType,
  }
}

/** A Commander-selected Terra globe pin, represented as evidence for the single decree it attaches to. */
export function buildTerraEvidenceItem(args: {
  terraContextText: string
  observedAt: string
  id?: string
}): IntelligenceEvidenceItem {
  return baseEvidenceItem(
    {
      id: args.id ?? `terra-${args.observedAt}`,
      source_id: 'terra-globe-selection',
      source_label: 'Terra globe selection',
      title: 'Commander Terra context',
      claim: args.terraContextText,
      content: args.terraContextText,
      observed_at: args.observedAt,
      confidence_tier: 'verified',
      freshness: 'live',
    },
    'TERRA',
    'direct_fetch',
    'verified',
  )
}

/** A verified local backend/runtime status fact (e.g. "Ollama responded normally this round"). */
export function buildRuntimeTelemetryEvidenceItem(args: {
  claim: string
  content: string
  observedAt: string
  id?: string
  sourceLabel?: string
}): IntelligenceEvidenceItem {
  return baseEvidenceItem(
    {
      id: args.id ?? `runtime-telemetry-${args.observedAt}`,
      source_id: 'council-runtime-status',
      source_label: args.sourceLabel ?? 'War Room runtime status',
      title: 'Runtime telemetry',
      claim: args.claim,
      content: args.content,
      observed_at: args.observedAt,
      confidence_tier: 'verified',
      freshness: 'live',
    },
    'RUNTIME_TELEMETRY',
    'direct_fetch',
    'verified',
  )
}

/** A claim that is the model's own inference/reasoning, not backed by any external retrieval. */
export function buildModelInferenceEvidenceItem(args: {
  claim: string
  content: string
  observedAt: string
  id?: string
  sourceLabel?: string
}): IntelligenceEvidenceItem {
  return baseEvidenceItem(
    {
      id: args.id ?? `model-inference-${args.observedAt}`,
      source_id: 'council-model-inference',
      source_label: args.sourceLabel ?? 'Model inference',
      title: 'Model inference',
      claim: args.claim,
      content: args.content,
      observed_at: args.observedAt,
      confidence_tier: 'weak_signal',
      freshness: 'unknown',
    },
    'MODEL_INFERENCE',
    'direct_fetch',
    'unverified',
  )
}
