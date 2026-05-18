export type BabyAgentKey =
  | 'chatgpt-family-baby'
  | 'claude-family-baby'
  | 'grok-family-baby'
  | 'kimi-family-baby'
  | 'red-team-baby'
  | 'bridge-architect-baby'
  | 'analyst-baby'
  | 'income-operations-baby'

export type BabyGrowthLevel = 'seed' | 'observing' | 'learning' | 'useful' | 'specialist' | 'senior'

export type BabyLearningSource =
  | 'approved_council_output'
  | 'completed_project'
  | 'rejected_action'
  | 'repair_outcome'
  | 'opportunity_result'
  | 'analyst_finding'
  | 'commander_correction'

export type BabyLessonState = 'candidate' | 'commander_approved' | 'validated' | 'rejected' | 'archived'

export type BabySkill = {
  key: string
  label: string
  description: string
  progress: number
}

export type BabyAgent = {
  key: BabyAgentKey
  displayName: string
  familyIdentity: string
  cloudProvider: string
  role: string
  memoryScope: string[]
  growthLevel: BabyGrowthLevel
  skillTree: BabySkill[]
  confidenceScore: number
  usefulnessScore: number
  nextTrainingNeed: string
  latestLesson: string
}

export type BabyTrainingEvent = {
  id: string
  agentKey: BabyAgentKey
  source: BabyLearningSource
  summary: string
  lessonState: BabyLessonState
  observedOutcome: string
  commanderApprovalRequired: true
  createdAt: string
}

export const BABY_GROWTH_LEVELS: BabyGrowthLevel[] = [
  'seed',
  'observing',
  'learning',
  'useful',
  'specialist',
  'senior',
]

export const BABY_LEARNING_SOURCES: BabyLearningSource[] = [
  'approved_council_output',
  'completed_project',
  'rejected_action',
  'repair_outcome',
  'opportunity_result',
  'analyst_finding',
  'commander_correction',
]

export const BABY_AI_GUARDRAILS = {
  commanderApprovalRequired: true,
  hiddenExecutionAllowed: false,
  shellCommandsExposed: false,
  filesystemMutationAllowed: false,
  deploymentControlAllowed: false,
  destructiveActionsAllowed: false,
  fakeAutonomyAllowed: false,
  cloudProviderRequired: true,
} as const

export const BABY_AI_AGENTS: BabyAgent[] = [
  {
    key: 'chatgpt-family-baby',
    displayName: 'ChatGPT Family Baby',
    familyIdentity: 'ChatGPT Family',
    cloudProvider: 'OpenAI',
    role: 'Strategy synthesis, council coherence, and next-step framing.',
    memoryScope: ['approved council outputs', 'Commander corrections', 'completed project summaries'],
    growthLevel: 'observing',
    confidenceScore: 0.42,
    usefulnessScore: 0.36,
    nextTrainingNeed: 'Compare approved council plans against completed outcomes.',
    latestLesson: 'Keep strategy suggestions separate from approved action.',
    skillTree: [
      skill('strategic_synthesis', 'Strategic synthesis', 'Compress family output into useful options.', 0.38),
      skill('task_framing', 'Task framing', 'Turn council observations into approval-ready proposals.', 0.32),
      skill('truth_labeling', 'Truth labeling', 'Separate facts, assumptions, and wishes.', 0.44),
    ],
  },
  {
    key: 'claude-family-baby',
    displayName: 'Claude Family Baby',
    familyIdentity: 'Claude Family',
    cloudProvider: 'Anthropic',
    role: 'Architecture review, runtime truth, and boundary protection.',
    memoryScope: ['architecture decisions', 'repair outcomes', 'rejected unsafe actions'],
    growthLevel: 'observing',
    confidenceScore: 0.44,
    usefulnessScore: 0.4,
    nextTrainingNeed: 'Study repairs and identify which boundary would have prevented the issue.',
    latestLesson: 'A useful architecture note names the invariant and the blast radius.',
    skillTree: [
      skill('architecture_review', 'Architecture review', 'Review system boundaries and dependencies.', 0.42),
      skill('runtime_truth', 'Runtime truth', 'Report actual connected state without masking gaps.', 0.48),
      skill('safety_invariants', 'Safety invariants', 'Preserve approval gates and execution limits.', 0.46),
    ],
  },
  {
    key: 'grok-family-baby',
    displayName: 'Grok Family Baby',
    familyIdentity: 'Grok Family',
    cloudProvider: 'xAI',
    role: 'Signal triage, contradiction spotting, and opportunity framing.',
    memoryScope: ['opportunity results', 'analyst findings', 'rejected claims'],
    growthLevel: 'seed',
    confidenceScore: 0.34,
    usefulnessScore: 0.3,
    nextTrainingNeed: 'Observe opportunity outcomes before ranking similar signals.',
    latestLesson: 'No live signal should be claimed unless evidence is present.',
    skillTree: [
      skill('signal_triage', 'Signal triage', 'Rank signals by evidence and urgency.', 0.28),
      skill('contradiction_scan', 'Contradiction scan', 'Find mismatches between claims and evidence.', 0.36),
      skill('opportunity_framing', 'Opportunity framing', 'Frame income opportunities for review.', 0.27),
    ],
  },
  {
    key: 'kimi-family-baby',
    displayName: 'Kimi Family Baby',
    familyIdentity: 'Kimi Family',
    cloudProvider: 'Moonshot cloud',
    role: 'Task decomposition, dependency mapping, and sequence checks.',
    memoryScope: ['completed projects', 'workflow outcomes', 'Commander corrections'],
    growthLevel: 'seed',
    confidenceScore: 0.36,
    usefulnessScore: 0.31,
    nextTrainingNeed: 'Learn which task sequences led to completed projects.',
    latestLesson: 'A task plan is not execution; it must stop at approval gates.',
    skillTree: [
      skill('decomposition', 'Decomposition', 'Break goals into ordered reviewable steps.', 0.35),
      skill('dependency_mapping', 'Dependency mapping', 'Name prerequisites and blockers.', 0.33),
      skill('handoff_quality', 'Handoff quality', 'Make proposed next work easy to approve or reject.', 0.28),
    ],
  },
  {
    key: 'red-team-baby',
    displayName: 'Red Team Baby',
    familyIdentity: 'Red Team',
    cloudProvider: 'Anthropic',
    role: 'Adversarial review for overreach, hidden execution, and weak evidence.',
    memoryScope: ['rejected actions', 'repair outcomes', 'approval denials'],
    growthLevel: 'observing',
    confidenceScore: 0.45,
    usefulnessScore: 0.41,
    nextTrainingNeed: 'Track which warnings predicted real repair work or rejected actions.',
    latestLesson: 'Challenge capability claims before challenging motives.',
    skillTree: [
      skill('overreach_detection', 'Overreach detection', 'Spot fake autonomy and hidden execution paths.', 0.5),
      skill('risk_language', 'Risk language', 'State risks sharply without theatrics.', 0.38),
      skill('destructive_action_blocking', 'Destructive action blocking', 'Reject destructive proposals by default.', 0.52),
    ],
  },
  {
    key: 'bridge-architect-baby',
    displayName: 'Architecture Review Baby',
    familyIdentity: 'Claude Architecture Review',
    cloudProvider: 'Anthropic',
    role: 'Architecture review, runtime truth, and cloud-only integration guidance.',
    memoryScope: ['architecture decisions', 'runtime truth', 'repair outcomes'],
    growthLevel: 'observing',
    confidenceScore: 0.43,
    usefulnessScore: 0.39,
    nextTrainingNeed: 'Compare cloud provider readiness with Baby AI growth continuity.',
    latestLesson: 'Cloud provider readiness and approval gates define the Baby AI lane.',
    skillTree: [
      skill('architecture_boundary_mapping', 'Architecture boundary mapping', 'Explain what each cloud-only lane can and cannot do.', 0.47),
      skill('runtime_degradation', 'Runtime degradation', 'Keep useful status when cloud providers are unavailable.', 0.42),
      skill('integration_review', 'Integration review', 'Find weak joins between app modules.', 0.34),
    ],
  },
  {
    key: 'analyst-baby',
    displayName: 'Analyst Baby',
    familyIdentity: 'Analyst Family',
    cloudProvider: 'Cloud provider council',
    role: 'Finding review, evidence grading, and insight-to-lesson conversion.',
    memoryScope: ['analyst findings', 'validated outcomes', 'Commander corrections'],
    growthLevel: 'seed',
    confidenceScore: 0.35,
    usefulnessScore: 0.33,
    nextTrainingNeed: 'Watch which analyst findings become validated outcomes.',
    latestLesson: 'Findings need evidence strength before they become durable lessons.',
    skillTree: [
      skill('evidence_grading', 'Evidence grading', 'Separate strong, weak, and missing evidence.', 0.31),
      skill('finding_synthesis', 'Finding synthesis', 'Convert findings into concise observations.', 0.34),
      skill('outcome_followup', 'Outcome follow-up', 'Track whether a finding helped later decisions.', 0.27),
    ],
  },
  {
    key: 'income-operations-baby',
    displayName: 'Income Operations Baby',
    familyIdentity: 'Income Operations',
    cloudProvider: 'Cloud provider council',
    role: 'Income workflow observation, payout risk notes, and approval-ready task proposals.',
    memoryScope: ['opportunity results', 'economic workflows', 'payment guard findings'],
    growthLevel: 'seed',
    confidenceScore: 0.33,
    usefulnessScore: 0.32,
    nextTrainingNeed: 'Observe which opportunities converted, expired, or were rejected.',
    latestLesson: 'Never claim income, payout, or deployment completion without persisted proof.',
    skillTree: [
      skill('income_workflow_review', 'Income workflow review', 'Summarize income workflow status truthfully.', 0.3),
      skill('payout_risk_notes', 'Payout risk notes', 'Flag payment and fulfillment risk before action.', 0.29),
      skill('approval_ready_proposals', 'Approval-ready proposals', 'Suggest next checks for Commander approval.', 0.28),
    ],
  },
]

function skill(key: string, label: string, description: string, progress: number): BabySkill {
  return { key, label, description, progress }
}

export function getBabyAgent(key: BabyAgentKey): BabyAgent | null {
  return BABY_AI_AGENTS.find(agent => agent.key === key) ?? null
}

export function growthLevelIndex(level: BabyGrowthLevel): number {
  return BABY_GROWTH_LEVELS.indexOf(level)
}
