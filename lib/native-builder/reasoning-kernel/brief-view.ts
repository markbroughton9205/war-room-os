/**
 * Commander-facing reasoning panel. Reads a persisted brief. Does not call a model.
 */
export type ReasoningPanelInput = {
  strategy?: string
  depth?: string
  status?: string
  activeHypotheses?: string[]
  selectedPlan?: string
  latestEvidence?: string[]
  evidence?: string[]
  contradictions?: string[]
  verification?: string
  verificationState?: string
  searchBranches?: Array<{ label: string; status: string; note?: string }>
  nextReasoningAction?: string
  reasonForSelection?: string
  previousStrategy?: string
  strategyTrigger?: string
  blockedReason?: string | null
} | null

export type ReasoningPanelModel = {
  attached: boolean
  strategy: string
  depth: string
  status: string
  hypotheses: string[]
  plan: string
  evidence: string[]
  contradictions: string[]
  verification: string
  branches: string[]
  nextAction: string
  why: string
  previousStrategy: string
  trigger: string
}

export function reasoningPanelModel(brief: ReasoningPanelInput): ReasoningPanelModel {
  if (!brief) {
    return {
      attached: false,
      strategy: 'No session',
      depth: 'No session',
      status: 'No session',
      hypotheses: ['None'],
      plan: 'None',
      evidence: ['None'],
      contradictions: ['None'],
      verification: 'No reasoning kernel session is attached.',
      branches: ['None'],
      nextAction: 'Attach a reasoning session.',
      why: 'No session',
      previousStrategy: 'No session',
      trigger: 'No session',
    }
  }
  const hypotheses = brief.activeHypotheses?.length ? brief.activeHypotheses : ['None']
  const evidence = (brief.latestEvidence?.length ? brief.latestEvidence : brief.evidence) ?? []
  const branches = brief.searchBranches?.length
    ? brief.searchBranches.map(item => item.note ? `${item.label} — ${item.status}: ${item.note}` : `${item.label} — ${item.status}`)
    : ['None']
  return {
    attached: true,
    strategy: brief.strategy || 'unselected',
    depth: brief.depth || 'unselected',
    status: brief.status || 'OPEN',
    hypotheses,
    plan: brief.selectedPlan || 'none',
    evidence: evidence.length ? evidence : ['None'],
    contradictions: brief.contradictions?.length ? brief.contradictions : ['None'],
    verification: brief.verificationState || brief.verification || 'not proven',
    branches,
    nextAction: brief.nextReasoningAction || 'gather discriminating evidence',
    why: brief.reasonForSelection || 'unrecorded',
    previousStrategy: brief.previousStrategy || 'none',
    trigger: brief.strategyTrigger || 'none',
  }
}

export function reasoningPanelText(brief: ReasoningPanelInput): string {
  const model = reasoningPanelModel(brief)
  return [
    `Strategy: ${model.strategy}`,
    `Depth: ${model.depth}`,
    `Status: ${model.status}`,
    `Hypotheses: ${model.hypotheses.join('; ')}`,
    `Plan: ${model.plan}`,
    `Evidence: ${model.evidence.join('; ')}`,
    `Contradictions: ${model.contradictions.join('; ')}`,
    `Verification: ${model.verification}`,
    `Branches: ${model.branches.join(' | ')}`,
    `Next: ${model.nextAction}`,
    `Why: ${model.why}`,
    `Previous: ${model.previousStrategy}`,
    `Trigger: ${model.trigger}`,
  ].join('\n')
}
