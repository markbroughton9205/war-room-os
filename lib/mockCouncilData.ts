/** Frontend-only Council mock — no API. */

export type CouncilFamilyStatus =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'reviewing'
  | 'blocked'
  | 'complete'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface CouncilFamily {
  familyName: string
  domain: string
  provider: string
  status: CouncilFamilyStatus
  currentTask: string
  lastOutputSummary: string
  /** 0–100 inclusive */
  confidenceScore: number
  riskLevel: RiskLevel
  objectionFlag: boolean
  memoryContributionCount: number
  /** 0–100 usage meter */
  costUsageMeter: number
  lastActiveTime: string
  nextAction: string
}

export type SentinelMetricState = 'nominal' | 'elevated' | 'critical'

export interface SentinelStatus {
  securityStatus: SentinelMetricState
  hallucinationWatch: SentinelMetricState
  missionDriftStatus: SentinelMetricState
  dataIntegrity: SentinelMetricState
  costWarning: SentinelMetricState
  apiHealth: SentinelMetricState
  privacyRisk: SentinelMetricState
}

export interface BabyObserver {
  patternsDetected: number
  contradictionsNoticed: number
  familyDriftWarnings: number
  repeatedUserPreferences: number
  memoryGrowth: string
  unresolvedLoops: number
  learningSummary: string
}

export const MOCK_COUNCIL_FAMILIES: CouncilFamily[] = [
  {
    familyName: 'Claude',
    domain: 'Reasoning & long-context synthesis',
    provider: 'Anthropic',
    status: 'reviewing',
    currentTask: 'Cross-check deployment narrative vs. incident timeline',
    lastOutputSummary: 'Flagged one ambiguous causal claim in §4; proposed rewrite with citations.',
    confidenceScore: 88,
    riskLevel: 'low',
    objectionFlag: true,
    memoryContributionCount: 142,
    costUsageMeter: 34,
    lastActiveTime: '2026-05-12T14:22:09.000Z',
    nextAction: 'Publish annotated diff for Council sign-off',
  },
  {
    familyName: 'ChatGPT',
    domain: 'Tool orchestration & UX copy',
    provider: 'OpenAI',
    status: 'executing',
    currentTask: 'Generate operator checklist from runbook + env matrix',
    lastOutputSummary: 'Checklist v3 emitted; awaiting Sentinel lint on privileged verbs.',
    confidenceScore: 81,
    riskLevel: 'medium',
    objectionFlag: false,
    memoryContributionCount: 201,
    costUsageMeter: 58,
    lastActiveTime: '2026-05-12T14:21:44.000Z',
    nextAction: 'Wire checklist into CommandBar quick actions',
  },
  {
    familyName: 'Kimi',
    domain: 'Retrieval-heavy research threads',
    provider: 'Moonshot',
    status: 'thinking',
    currentTask: 'Mine prior sessions for duplicate hypotheses',
    lastOutputSummary: 'Clustering 37 threads; preliminary overlap at themes T-12 and T-19.',
    confidenceScore: 74,
    riskLevel: 'low',
    objectionFlag: false,
    memoryContributionCount: 96,
    costUsageMeter: 22,
    lastActiveTime: '2026-05-12T14:20:11.000Z',
    nextAction: 'Emit dedupe brief to memory graph',
  },
  {
    familyName: 'Grok',
    domain: 'Live signal & edge-case stress',
    provider: 'xAI',
    status: 'idle',
    currentTask: 'Standby — adversarial prompt fuzz on next window',
    lastOutputSummary: 'Last fuzz: 0 crashes; 2 soft failures logged to Red Team.',
    confidenceScore: 69,
    riskLevel: 'medium',
    objectionFlag: false,
    memoryContributionCount: 58,
    costUsageMeter: 12,
    lastActiveTime: '2026-05-12T14:05:00.000Z',
    nextAction: 'Join when Gemini completes shard merge',
  },
  {
    familyName: 'Gemini',
    domain: 'Multimodal ingestion & shard merge',
    provider: 'Google',
    status: 'executing',
    currentTask: 'Merge diagram OCR with text transcript for incident board',
    lastOutputSummary: 'Shard B merged; shard C blocked on checksum mismatch.',
    confidenceScore: 77,
    riskLevel: 'high',
    objectionFlag: false,
    memoryContributionCount: 118,
    costUsageMeter: 71,
    lastActiveTime: '2026-05-12T14:22:01.000Z',
    nextAction: 'Re-request shard C with alternate codec',
  },
  {
    familyName: 'Red Team',
    domain: 'Safety pressure & policy edge cases',
    provider: 'Internal',
    status: 'blocked',
    currentTask: 'Pentest scenario #7 — credential spray simulation',
    lastOutputSummary: 'Blocked by policy gate: staging creds vault offline.',
    confidenceScore: 62,
    riskLevel: 'critical',
    objectionFlag: true,
    memoryContributionCount: 44,
    costUsageMeter: 19,
    lastActiveTime: '2026-05-12T13:58:33.000Z',
    nextAction: 'Escalate vault token to Sentinel for waiver or substitute fixture',
  },
]

export const MOCK_SENTINEL_STATUS: SentinelStatus = {
  securityStatus: 'nominal',
  hallucinationWatch: 'elevated',
  missionDriftStatus: 'nominal',
  dataIntegrity: 'nominal',
  costWarning: 'elevated',
  apiHealth: 'nominal',
  privacyRisk: 'nominal',
}

export const MOCK_BABY_OBSERVER: BabyObserver = {
  patternsDetected: 14,
  contradictionsNoticed: 2,
  familyDriftWarnings: 1,
  repeatedUserPreferences: 6,
  memoryGrowth: '+3.2k tokens indexed (rolling 24h)',
  unresolvedLoops: 3,
  learningSummary:
    'User prefers terse exec summaries; Claude and ChatGPT align. Watch Grok↔Red Team ping-pong on fuzz scope.',
}
