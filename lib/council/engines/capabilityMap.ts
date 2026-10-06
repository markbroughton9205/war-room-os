/**
 * ENGINE-01-CAPABILITY-MAP
 * EXISTS = live-proven implementation
 * PARTIAL = present but incomplete vs engine contract
 * MISSING = not implemented before ENGINE-01
 * SHOULD-EXTRACT-INTO-ENGINE = wrap, do not rewrite
 */
export type CapabilityStatus = 'EXISTS' | 'PARTIAL' | 'MISSING' | 'SHOULD-EXTRACT-INTO-ENGINE'

export type CapabilityRow = {
  capability: string
  status: CapabilityStatus
  source: string
}

export const ENGINE_01_CAPABILITY_MAP: readonly CapabilityRow[] = [
  { capability: 'domain-aware discovery plan', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'researchPolicy.classifyResearchIntent + constructDomainQueries' },
  { capability: 'domain routing (FDA/SEC/court/software/MoE/news)', status: 'EXISTS', source: 'researchPolicy.classifyResearchDomain' },
  { capability: 'primary != arXiv synonym', status: 'EXISTS', source: 'researchPolicy.preferredAuthorities' },
  { capability: 'discovery candidates', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'researchDiscovery.ResearchSourceCandidate' },
  { capability: 'candidate identity / paper_identity', status: 'EXISTS', source: 'researchPolicy.identityKey / paperIdentity' },
  { capability: 'typed ResearchDiscoveryPlan', status: 'MISSING', source: 'ENGINE-01A' },
  { capability: 'exported discovery stop rule', status: 'PARTIAL', source: 'councilClient inline caps; ENGINE-01A exports decideDiscoveryStop' },
  { capability: 'source relevance hard gate', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'researchPolicy.evaluateSourceRelevance' },
  { capability: 'semantic relevance (embedding)', status: 'PARTIAL', source: 'lexical/token overlap; still a hard gate' },
  { capability: 'authority classification', status: 'EXISTS', source: 'researchPolicy.classifySourceAuthority' },
  { capability: 'strict freshness + DATE_UNKNOWN', status: 'EXISTS', source: 'researchPolicy.assessFreshness / satisfiesStrictWindow' },
  { capability: 'retrieved_at is not publication freshness', status: 'EXISTS', source: 'researchPolicy.assessFreshness' },
  { capability: 'independence score in relevance', status: 'PARTIAL', source: 'identityKey dedupe; independence field was stub 1' },
  { capability: 'SourceAssessment contract', status: 'MISSING', source: 'ENGINE-01B' },
  { capability: 'REJECT_UNSAFE_OR_INVALID', status: 'MISSING', source: 'ENGINE-01B' },
  { capability: 'claim-evidence ID binding', status: 'EXISTS', source: 'EbcClaim.evidence_ids + board supports' },
  { capability: 'usable external evidence gate', status: 'EXISTS', source: 'researchTruth.isUsableExternalEvidence' },
  { capability: 'sourceless VERIFIED blocked', status: 'EXISTS', source: 'verifyClaimLumen + applyLumenPromotion + demoteSourcelessExternalClaims' },
  { capability: 'typed support types DIRECT/CORROBORATING/...', status: 'PARTIAL', source: 'publicSourceRecords.support_type; ENGINE-01C formalizes' },
  { capability: 'typed EvidenceConflict', status: 'PARTIAL', source: 'EbcConflict; ENGINE-01C EvidenceConflict adapter' },
  { capability: 'board contradicts relation writes', status: 'MISSING', source: 'type exists; ENGINE-01C records conflicts without replacing EBC' },
  { capability: 'claim-evidence graph', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'board relations + ENGINE-01C graph view' },
  { capability: 'discrete calibration states', status: 'MISSING', source: 'ENGINE-01D; deriveConfidence remains heuristic overlay' },
  { capability: 'observable calibration explanations', status: 'MISSING', source: 'ENGINE-01D' },
  { capability: 'PULSAR discovery/authority consume', status: 'PARTIAL', source: 'councilClient uses policy; ENGINE-01 wires typed consume' },
  { capability: 'ORION consume gaps/conflicts', status: 'PARTIAL', source: 'orionInvestigate; ENGINE-01 packet' },
  { capability: 'LUMEN consume binding/calibration', status: 'SHOULD-EXTRACT-INTO-ENGINE', source: 'verifyClaimLumen + lumenQuality' },
  { capability: 'PHOENIX challenge weak claims', status: 'EXISTS', source: 'phoenixChallenge; ENGINE-01 feeds targets' },
  { capability: 'AURORA no new facts / no unbound claims', status: 'EXISTS', source: 'synthesizeAurora claimHasUsable' },
  { capability: 'EBC append-only truth spine', status: 'EXISTS', source: 'evidence-board; engines store typed refs only' },
  { capability: 'engine receipts', status: 'MISSING', source: 'ENGINE-01 framework' },
  { capability: 'assessment cache by identity+policy+window', status: 'MISSING', source: 'ENGINE-01B cache' },
] as const
