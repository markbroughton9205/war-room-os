export type FamilyTipPriority = 'low' | 'medium' | 'high'

export type FamilyTip = {
  tip_id: string
  panel_id:
    | 'live_environment'
    | 'analysts'
    | 'opportunity_scout'
    | 'agent_foundry'
    | 'learning'
    | 'automation'
    | 'diagnostics'
    | 'system_health'
    | 'engineering'
    | 'memory'
  family: string
  title: string
  insight: string
  why_it_matters: string
  suggested_decree: string
  priority: FamilyTipPriority
  confidence: 'verified' | 'emerging'
  related_sources: string[]
  created_at: string
}

const CREATED_AT = '2026-05-17T00:00:00.000Z'

export const FAMILY_TIPS: FamilyTip[] = [
  {
    tip_id: 'live-env-akron-business-signals',
    panel_id: 'live_environment',
    family: 'Grok Family',
    title: 'Watch Akron Opportunity Signals',
    insight: 'Local news, weather, markets, and public safety context can shape what to investigate next.',
    why_it_matters: 'Income and logistics decisions are better when the Council sees the local operating environment first.',
    suggested_decree: 'Grok, investigate Akron local business and opportunity signals and report verified, emerging, contradictions, and unknowns.',
    priority: 'high',
    confidence: 'verified',
    related_sources: ['Live Environment', 'Local Signals', 'News Intel'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'analysts-verify-contradictions',
    panel_id: 'analysts',
    family: 'Gemini Family',
    title: 'Cross-Check Analyst Claims',
    insight: 'Analyst packets should separate verified facts, emerging signals, contradictions, and unknowns.',
    why_it_matters: 'Cleaner evidence prevents premature decisions from weak or conflicting intelligence.',
    suggested_decree: 'Gemini, cross-check the current analyst findings and identify verified facts, contradictions, and unknowns.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['Analysts', 'Diagnostics'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'opportunity-scout-family-fit',
    panel_id: 'opportunity_scout',
    family: 'ChatGPT Family',
    title: 'Turn Signals Into Action',
    insight: 'Promising opportunities should be converted into bounded next steps before they decay.',
    why_it_matters: 'A small verified action beats a large untriaged opportunity list.',
    suggested_decree: 'ChatGPT, convert the strongest current opportunity signal into a bounded next-action plan with risks and approval gates.',
    priority: 'high',
    confidence: 'verified',
    related_sources: ['Opportunity Scout', 'Memory'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'agent-foundry-route-work',
    panel_id: 'agent_foundry',
    family: 'Bridge Architect',
    title: 'Route Work Deliberately',
    insight: 'Engineering tasks should be assigned only after scope, permissions, and rollback path are clear.',
    why_it_matters: 'This preserves approval gates and avoids hidden execution.',
    suggested_decree: 'Bridge Architect, prepare a safe routing plan for the next engineering task with permissions, rollback, and owner.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['Agent Foundry', 'Engineering'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'learning-capture-patterns',
    panel_id: 'learning',
    family: 'Baby AI',
    title: 'Capture Learnings',
    insight: 'Repeated operator preferences should become lightweight memory candidates.',
    why_it_matters: 'Family orchestration improves when recurring patterns are remembered with boundaries.',
    suggested_decree: 'Baby AI, summarize the latest learning pattern and propose whether it belongs in memory.',
    priority: 'low',
    confidence: 'emerging',
    related_sources: ['Learning', 'Memory'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'automation-approval-gates',
    panel_id: 'automation',
    family: 'Red Team',
    title: 'Keep Automation Gated',
    insight: 'Automation should remain visible, reversible, and approval-bound.',
    why_it_matters: 'Hidden execution would violate War Room runtime truth and operator control.',
    suggested_decree: 'Red Team, review the current automation path for hidden execution, missing approvals, and rollback gaps.',
    priority: 'high',
    confidence: 'verified',
    related_sources: ['Automation', 'Approvals'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'diagnostics-fix-root-cause',
    panel_id: 'diagnostics',
    family: 'Claude Family',
    title: 'Fix Root Causes',
    insight: 'Diagnostics should lead to one repairable cause, not scattered symptoms.',
    why_it_matters: 'Repair focus keeps the system reliable without adding noisy workarounds.',
    suggested_decree: 'Claude, inspect current diagnostics and identify the most likely root cause plus the smallest safe fix.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['Diagnostics', 'System Health'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'system-health-readiness',
    panel_id: 'system_health',
    family: 'ChatGPT Family',
    title: 'Readiness Before Action',
    insight: 'Provider, memory, and queue readiness should shape what the Council attempts.',
    why_it_matters: 'Runtime-aware decisions avoid pretending unavailable systems are ready.',
    suggested_decree: 'ChatGPT, summarize current system readiness and recommend only actions supported by available providers.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['System Health', 'Configuration Sweep'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'engineering-bounded-change',
    panel_id: 'engineering',
    family: 'Claude Family',
    title: 'Keep Changes Bounded',
    insight: 'Engineering work should stay scoped to the requested surface and validated before handoff.',
    why_it_matters: 'Bounded changes are easier to review, test, and roll back.',
    suggested_decree: 'Claude, prepare a bounded engineering plan with files, risks, tests, and rollback notes.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['Engineering', 'Diagnostics'],
    created_at: CREATED_AT,
  },
  {
    tip_id: 'memory-boundary-check',
    panel_id: 'memory',
    family: 'Memory Archive',
    title: 'Respect Memory Boundaries',
    insight: 'Only durable, useful, non-sensitive context should be promoted into memory.',
    why_it_matters: 'Good memory improves continuity without leaking private or temporary details.',
    suggested_decree: 'Memory Archive, review current context for safe memory candidates and explain what should not be stored.',
    priority: 'medium',
    confidence: 'verified',
    related_sources: ['Memory', 'Live Council'],
    created_at: CREATED_AT,
  },
]

export function familyTipsForPanel(panelId: FamilyTip['panel_id']): FamilyTip[] {
  return FAMILY_TIPS.filter(tip => tip.panel_id === panelId)
}
