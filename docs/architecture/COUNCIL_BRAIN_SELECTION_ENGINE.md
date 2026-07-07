# Council Brain Selection Engine

Phase 46D adds recommendation-only brain selection on top of Phase 46C Routing Notes.

This phase is architecture-only. It does not call providers, perform live health checks, change chat behavior, alter provider routing, or wire anything into live orchestration.

## Flow

```text
Commander message
-> RoutingNote
-> BrainRecommendation
-> Phase 46E execution later
```

## Boundary

The Brain Selection Engine ranks possible brains for a routing decision.

It does not execute the recommendation.

Every recommendation must keep:

```ts
executionAllowed: false
```

## Brain Recommendation Shape

```ts
type BrainRecommendation = {
  recommendationId: string
  routingId: string
  requiredBrainProfile: {
    reasoningStyle: 'architectural' | 'strategic' | 'research' | 'coding' | 'risk' | 'synthesis'
    contextWindowNeed: 'low' | 'medium' | 'high'
    latencyTolerance: 'fast' | 'normal' | 'slow'
    costSensitivity: 'low' | 'medium' | 'high'
    privacySensitivity: 'low' | 'medium' | 'high'
    liveResearchNeed: boolean
    toolUseNeed: boolean
  }
  rankedCandidates: BrainCandidate[]
  selectedCandidateId: string | null
  approvalRequired: boolean
  reason: string
  decisionPath: string[]
  executionAllowed: false
  createdAt: string
}
```

## Candidate Shape

```ts
type BrainCandidate = {
  candidateId: string
  providerId: string
  modelId: string | null
  providerFamily: 'openai' | 'anthropic' | 'google' | 'xai' | 'moonshot' | 'local' | 'static'
  fitScore: number
  costScore: number
  latencyScore: number
  reliabilityScore: number
  privacyScore: number
  capabilityScore: number
  totalScore: number
  strengths: string[]
  weaknesses: string[]
  riskLevel: 'low' | 'medium' | 'high'
  approvalRequired: boolean
  unavailableReason?: string
}
```

## Scoring Model

All scores are 0-1 internally.

Default balanced weights:

```text
fitScore: 0.25
capabilityScore: 0.25
reliabilityScore: 0.20
costScore: 0.10
latencyScore: 0.10
privacyScore: 0.10
```

Formula:

```text
totalScore =
  fitScore * fitWeight
  + capabilityScore * capabilityWeight
  + reliabilityScore * reliabilityWeight
  + costScore * costWeight
  + latencyScore * latencyWeight
  + privacyScore * privacyWeight
```

Display percentage, if ever shown later:

```ts
Math.round(totalScore * 100)
```

## Weight Adjustments

Adjustments are applied to the default weights, then normalized to sum to 1.0.

- `costSensitivity: high` sets cost weight to `0.25`.
- `latencyTolerance: fast` sets latency weight to `0.25`.
- `privacySensitivity: high` sets privacy weight to `0.30`.
- `contextWindowNeed: high` sets capability weight to `0.35`.

### Cost-Sensitivity Proportional Reduction

The instruction "reduce capability/latency proportionally" is interpreted this way:

1. Cost weight increases from `0.10` to `0.25`.
2. The added `0.15` weight is taken only from capability and latency.
3. Capability and latency contribute to that reduction in proportion to their current weights.
4. With default weights, capability is `0.25` and latency is `0.10`; their combined weight is `0.35`.
5. Capability pays `0.15 * (0.25 / 0.35)`.
6. Latency pays `0.15 * (0.10 / 0.35)`.
7. The whole weight set is then normalized.

This preserves the scoring rule while making cost sensitivity meaningfully favor cheaper/local candidates.

## Live Research and Tool Needs

When `liveResearchNeed` is true:

- Candidates with live research support receive fit and capability preference.
- Static/local candidates receive a weakness unless they have cached/local research support.

When `toolUseNeed` is true:

- Tool-capable candidates receive fit preference.

No live tool checks are performed in Phase 46D.

## Deterministic Tie-Breaker

Candidates are ranked by:

1. Higher `totalScore`
2. Higher `reliabilityScore`
3. Lower cost, represented by higher `costScore`
4. Prefer `local` or `static` over paid external candidates
5. Preserve registry order

## Approval

Recommendation-level `approvalRequired` is true if the selected candidate is:

- Premium
- Costly
- External
- Live-research-enabled
- Selected for a privacy-sensitive profile

This does not grant execution.

## Static Candidate Registry

Phase 46D uses static registry metadata only.

Candidate families:

- Static War Room rules
- Local Ollama candidate
- Anthropic architectural candidate
- OpenAI strategic candidate
- Google librarian candidate
- xAI scout candidate
- Moonshot engineer candidate

No health checks are performed.

No providers are called.

## Decision Path

Each recommendation includes a decision path with:

- Routing note attachment
- Brain profile resolution
- Dominant weighting reason
- Normalized weights
- Candidate ranking count
- Top recommendation
- Approval posture
- Execution disabled confirmation

## Non-Goals

Phase 46D does not:

- Execute providers
- Call model APIs
- Perform live provider health checks
- Wire into `/api/chat`
- Wire into `app/page.tsx`
- Mutate Routing Notes
- Mutate Council Entities
- Mutate Council Skills
- Change UI
- Change chat behavior

## Ready for Phase 46E

Phase 46E may consume a BrainRecommendation and decide whether execution should be allowed under approval gates.

Until then, every BrainRecommendation remains recommendation-only with `executionAllowed: false`.
