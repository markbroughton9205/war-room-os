import type {
  EvidenceConfidenceTier,
  EvidenceFreshness,
  EvidenceOriginType,
  IntelligenceEvidenceItem,
} from '@/lib/intelligence/intelligencePacket'

/**
 * Foundation constructors for the non-LIVE_WEB evidence origins introduced in Build #4A.
 *
 * `normalizeSourceEvidence` is the live producer of LIVE_WEB items. Terra, runtime telemetry,
 * and model inference have factories. KIMI_WAVE and STORED_RESEARCH are produced by
 * lib/intelligence/kimiWaves and lib/intelligence/storedResearch — never by the live normalizer.
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
  published_at?: string
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
    ...(args.published_at ? { published_at: args.published_at } : {}),
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

/** Preserved Kimi Wave markdown — historical/source intelligence, never live web. */
export function buildKimiWaveEvidenceItem(args: BaseEvidenceArgs): IntelligenceEvidenceItem {
  return baseEvidenceItem(args, 'KIMI_WAVE', 'direct_fetch', 'unverified')
}

/** Structured prior War Room research — replayed, never silently LIVE_WEB. */
export function buildStoredResearchEvidenceItem(args: BaseEvidenceArgs): IntelligenceEvidenceItem {
  return baseEvidenceItem(args, 'STORED_RESEARCH', 'direct_fetch', 'semi_verified')
}
