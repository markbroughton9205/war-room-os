import type { SignalFreshnessStatus } from '@/lib/signals/model'

export type ResearchStatus =
  | 'gathering_sources'
  | 'comparing_sources'
  | 'red_team_check'
  | 'final_answer_ready'
  | 'failed'

export type SourceEvidenceLabel = 'LIVE_SIGNAL_BACKED' | 'CACHED' | 'HISTORICAL_PATTERN_BASED' | 'UNVERIFIED'

export type SourceRef = {
  title: string
  url: string | null
  snippet: string
  provider: string
  freshnessStatus: SignalFreshnessStatus | 'unknown'
  confidence: number
  evidenceLabel: SourceEvidenceLabel
  publishedAt: string | null
}

export type CouncilStoryContext = {
  headline: string
  source: string
  url: string | null
  category: string
  shortSummary: string
  whyItMatters: string
  confidence: number
  freshnessStatus: SignalFreshnessStatus
  provider: string
}

export type CouncilResearchHandoff = {
  decree: string
  storyContext?: CouncilStoryContext
  action?: 'ask_council' | 'investigate' | 'send_to_analysts' | 'create_opportunity'
}

export type FamilyRoleOutput = {
  family: 'grok' | 'claude' | 'chatgpt' | 'gemini' | 'red_team' | 'baby'
  content: string
  ok: boolean
  error?: string
}

export type ResearchReport = {
  markdown: string
  status: ResearchStatus
  phases: ResearchStatus[]
  sources: SourceRef[]
  confidenceLevel: 'high' | 'medium' | 'low' | 'unknown'
  confidenceScore: number
  unknowns: string[]
  sourcesUnavailable: boolean
  operatorGuidance: string | null
  proposedOpportunity: {
    title: string
    whyNow: string
    evidenceLabel: SourceEvidenceLabel
  } | null
  babyLessonCandidate: { text: string } | null
  generatedAt: string
  familyOutputs: FamilyRoleOutput[]
}

export type CouncilResearchRunInput = {
  decree: string
  storyContext?: CouncilStoryContext
  threadId?: string | null
  profile?: string
  onPhase?: (phase: ResearchStatus) => void
}
