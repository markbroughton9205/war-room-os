import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'

export type ResearchFailurePolicyResult = {
  familiesMayUseModelKnowledge: boolean
  mustLabelNonCurrent: boolean
  synthesisMustMarkGaps: boolean
  pretendLiveEvidence: boolean
  notes: string[]
}

export function applyResearchFailurePolicy(packet: LiveResearchEvidencePacket | null | undefined): ResearchFailurePolicyResult {
  if (!packet) {
    return {
      familiesMayUseModelKnowledge: true,
      mustLabelNonCurrent: true,
      synthesisMustMarkGaps: true,
      pretendLiveEvidence: false,
      notes: ['no_packet'],
    }
  }
  const anyOk = packet.sources.some(s => s.ok)
  const allFailed = packet.sources.length > 0 && packet.sources.every(s => !s.ok)
  if (allFailed || (!packet.usedLiveResearch && !anyOk)) {
    return {
      familiesMayUseModelKnowledge: true,
      mustLabelNonCurrent: true,
      synthesisMustMarkGaps: true,
      pretendLiveEvidence: false,
      notes: ['all_research_failed_or_empty'],
    }
  }
  if (!packet.usedLiveResearch || packet.sources.some(s => !s.ok)) {
    return {
      familiesMayUseModelKnowledge: true,
      mustLabelNonCurrent: true,
      synthesisMustMarkGaps: true,
      pretendLiveEvidence: false,
      notes: ['partial_research_failure'],
    }
  }
  return {
    familiesMayUseModelKnowledge: false,
    mustLabelNonCurrent: false,
    synthesisMustMarkGaps: false,
    pretendLiveEvidence: false,
    notes: ['live_evidence_present'],
  }
}
