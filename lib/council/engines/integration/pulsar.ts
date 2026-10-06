import { planResearchDiscovery, runResearchDiscoveryEngine } from '../research-discovery/engine'
import { assessSourceAuthority } from '../source-authority/engine'
import type { ResearchDiscoveryInput, ResearchDiscoveryPlan, EngineSourceCandidate } from '../research-discovery/types'
import type { SourceAssessment, SourceAuthorityInput } from '../source-authority/types'

export type PulsarEnginePacket = {
  plan: ResearchDiscoveryPlan
  candidates: EngineSourceCandidate[]
  assessments: SourceAssessment[]
  accepted: SourceAssessment[]
}

export function pulsarConsumeDiscovery(input: ResearchDiscoveryInput, urls: readonly { url: string; title?: string }[] = []): PulsarEnginePacket {
  const discovery = runResearchDiscoveryEngine(input, urls)
  return {
    plan: discovery.plan,
    candidates: discovery.candidates,
    assessments: [],
    accepted: [],
  }
}

export function pulsarConsumeAssessments(
  packet: PulsarEnginePacket,
  rows: readonly Omit<SourceAuthorityInput, 'mission_id' | 'prompt'>[],
  prompt: string,
  mission_id: string,
): PulsarEnginePacket {
  const acceptedIdentities: string[] = []
  const assessments: SourceAssessment[] = []
  for (const row of rows) {
    const assessment = assessSourceAuthority({
      ...row,
      mission_id,
      prompt,
      accepted_identities: acceptedIdentities,
    })
    assessments.push(assessment)
    if (assessment.decision === 'ACCEPT') acceptedIdentities.push(assessment.candidate_id)
  }
  return {
    ...packet,
    plan: packet.plan.normalized_question ? packet.plan : planResearchDiscovery({ mission_id, question: prompt }),
    assessments,
    accepted: assessments.filter(row => row.decision === 'ACCEPT'),
  }
}
