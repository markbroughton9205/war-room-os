import type { RepairClassification } from './model'

export const REPAIR_TRIGGER_DECREES = [
  'fix this',
  'repair War Room',
  'diagnose this panel',
  'why is this broken',
  'create a repair packet',
  'send this to Cursor',
  'prepare engineering task',
] as const

type ClassificationRule = {
  classification: RepairClassification
  pattern: RegExp
  files: string[]
  rootCause: string
  recommendedFix: string[]
  riskNotes: string[]
}

const RULES: ClassificationRule[] = [
  {
    classification: 'security_truth_boundary_issue',
    pattern: /\b(security|truth|guardrail|hidden|fake|unsafe|execute|shell|mutate|deploy|cursor api|secret|key)\b/i,
    files: ['lib/council/runtimeTruth.ts', 'lib/runtime', 'lib/kernel', 'app/api', 'components/war-room'],
    rootCause: 'A truth-boundary or execution-boundary claim may be leaking into UI or orchestration copy without enough guardrail context.',
    recommendedFix: [
      'Trace the claim to the server-side truth source and remove any unsupported connected/complete language.',
      'Keep all repair output advisory and approval-gated; expose only manual copy handoff text.',
      'Add explicit no-execution copy near any Cursor or repair handoff action.',
    ],
    riskNotes: [
      'Do not expose secrets, key names, or server-only implementation details in browser copy.',
      'Do not add browser code paths that execute shell commands, mutate files, deploy, commit, or push.',
    ],
  },
  {
    classification: 'provider_runtime_issue',
    pattern: /\b(provider|runtime|openai|anthropic|claude|grok|xai|gemini|google|health|canonical|engine)\b/i,
    files: ['app/api/providers/health/route.ts', 'app/api/engine-control/status/route.ts', 'lib/providers/health.ts', 'lib/engine-control/status.ts', 'components/war-room/providers/ProviderRuntimePanel.tsx'],
    rootCause: 'Provider or runtime status may be degraded, stale, timeout-protected, or displayed inconsistently across panels.',
    recommendedFix: [
      'Compare canonical provider status with runtime integrity and engine-control status outputs.',
      'Normalize health labels and ensure failures are isolated per provider family.',
      'Keep status server-derived and timeout-bounded; never infer readiness from browser state.',
    ],
    riskNotes: [
      'Avoid claiming a provider is online without live or persisted evidence.',
      'Do not serialize credentials or raw provider errors to the client.',
    ],
  },
  {
    classification: 'supabase_schema_issue',
    pattern: /\b(supabase|schema|migration|table|rls|persistence|database|row|ledger)\b/i,
    files: ['lib/war-room/persistence.ts', 'supabase', 'app/api/events', 'lib/events', 'lib/learning'],
    rootCause: 'A persistence table, migration, or RLS/service-role boundary may be missing or not aligned with the UI contract.',
    recommendedFix: [
      'Inspect the API response for MIGRATION_REQUIRED or table-unavailable notes before changing UI behavior.',
      'Add idempotent migrations only after confirming table shape and service-role access requirements.',
      'Return a graceful fallback snapshot when persistence is unavailable.',
    ],
    riskNotes: [
      'Do not create public write paths for repair packets or ledger events.',
      'Preserve existing audit history; archive or mark rejected rows instead of deleting records.',
    ],
  },
  {
    classification: 'performance_issue',
    pattern: /\b(performance|slow|lag|hang|timeout|poll|render|memory|load|build)\b/i,
    files: ['components/war-room/performance', 'components/war-room/WarRoomLazyPanels.tsx', 'app/page.tsx', 'lib/council/providerTimeouts.ts'],
    rootCause: 'A panel, polling loop, provider timeout, or render path may be doing too much work on the client.',
    recommendedFix: [
      'Measure the slow surface first using existing performance diagnostics.',
      'Reduce eager work, memoize derived lists, and keep heavy panels behind lazy loading.',
      'Use short server timeouts and visible degraded states instead of browser retry loops.',
    ],
    riskNotes: [
      'Do not hide provider failures with indefinite loading states.',
      'Avoid broad refactors until the slow path is measured.',
    ],
  },
  {
    classification: 'routing_orchestration_issue',
    pattern: /\b(route|routing|orchestration|lane|queue|commander|command|project|feature builder|outcome|signal)\b/i,
    files: ['app/page.tsx', 'lib/projects/projectOrchestrator.ts', 'lib/projects/projectLaneRouter.ts', 'lib/feature-builder', 'components/war-room/signals/SignalRadarPanel.tsx', 'components/war-room/outcomes/OutcomeLedgerPanel.tsx'],
    rootCause: 'A Commander decree or panel handoff may be routed to the wrong advisory lane or missing a visible approval boundary.',
    recommendedFix: [
      'Trace the decree through command classification, project orchestration, and engineering packet generation.',
      'Ensure connected panels receive advisory summaries without implying execution happened.',
      'Keep routing additive and make every handoff visible in the activity/system ledger.',
    ],
    riskNotes: [
      'Do not queue real execution from a repair packet.',
      'Do not mark work completed until manual Cursor validation returns visible evidence.',
    ],
  },
  {
    classification: 'council_prompt_issue',
    pattern: /\b(council|prompt|family|response|chatgpt|red team|baby observer|observer|lesson)\b/i,
    files: ['components/council/councilPrompt.ts', 'components/council', 'lib/council', 'lib/baby-ai/councilIntegration.ts'],
    rootCause: 'Council prompt shaping or family response rendering may be omitting the repair context, guardrails, or Baby Observer lesson candidate.',
    recommendedFix: [
      'Inspect the council prompt addenda and response rendering for repair-specific language.',
      'Keep family contributions separated by role: synthesis, architecture, runtime, evidence, risk, and lesson candidate.',
      'Confirm Baby Observer output remains a candidate lesson only.',
    ],
    riskNotes: [
      'Do not let Baby Observer promote a permanent lesson without Commander approval or validated outcomes.',
      'Avoid prompt text that implies War Room can execute repairs itself.',
    ],
  },
  {
    classification: 'ui_issue',
    pattern: /\b(ui|panel|button|screen|display|render|badge|copy|layout|broken)\b/i,
    files: ['app/page.tsx', 'components/war-room', 'components/council'],
    rootCause: 'A client panel or message renderer may be missing state, showing stale labels, or not exposing the correct manual repair action.',
    recommendedFix: [
      'Inspect the affected panel and its API response contract.',
      'Add a small visible repair packet affordance that posts advisory context only.',
      'Display copied/manual handoff state without invoking Cursor or mutating files.',
    ],
    riskNotes: [
      'Keep clipboard copy as the only browser handoff behavior.',
      'Do not import server-only modules into client components.',
    ],
  },
  {
    classification: 'bug',
    pattern: /\b(bug|broken|error|failed|failure|fix|repair|diagnose|issue)\b/i,
    files: ['app/page.tsx', 'app/api', 'components/war-room', 'lib'],
    rootCause: 'The symptom is broad; the first repair pass should localize the failure before editing implementation code.',
    recommendedFix: [
      'Reproduce the broken panel or flow and identify the smallest failing boundary.',
      'Inspect the API route, shared library, and client component that own the visible symptom.',
      'Apply the smallest fix that preserves existing advisory and approval guardrails.',
    ],
    riskNotes: [
      'Avoid broad rewrites before the failing module is identified.',
      'Keep rollback notes specific to changed files once implementation begins.',
    ],
  },
]

export function compactRepairText(value: string, limit = 700): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

export function matchedRepairTriggers(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ')
  return REPAIR_TRIGGER_DECREES.filter(trigger => normalized.includes(trigger.toLowerCase()))
}

export function classifyRepairRequest(text: string): ClassificationRule {
  const normalized = text.trim()
  return RULES.find(rule => rule.pattern.test(normalized)) ?? RULES[RULES.length - 1]!
}
