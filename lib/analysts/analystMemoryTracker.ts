import type { AnalystTask } from './analystTaskPlanner'

export type OutcomeTrackKey =
  | 'project_success_failure'
  | 'provider_effectiveness'
  | 'repair_frequency'
  | 'approval_outcomes'
  | 'retrieval_success'
  | 'latency_performance'
  | 'operational_improvements'
  | 'recurring_problems'
  | 'market_news_pattern_changes'

export type AnalystMemoryObservation = {
  key: OutcomeTrackKey
  label: string
  observation: string
  learningUse: string
}

export type AnalystMemoryTracker = {
  mode: 'session_foundation'
  writePolicy: 'commander_approved_only'
  observations: AnalystMemoryObservation[]
  recurringSuccessPatterns: string[]
  recurringFailureSignals: string[]
  historicalComparisonSummary: string
  nonAutonomousBoundary: string
}

const TRACK_LABELS: Record<OutcomeTrackKey, string> = {
  project_success_failure: 'Project success/failure',
  provider_effectiveness: 'Provider effectiveness',
  repair_frequency: 'Repair frequency',
  approval_outcomes: 'Approval outcomes',
  retrieval_success: 'Retrieval success',
  latency_performance: 'Latency/performance',
  operational_improvements: 'Operational improvements',
  recurring_problems: 'Recurring problems',
  market_news_pattern_changes: 'Market/news pattern changes',
}

function observation(key: OutcomeTrackKey, detail: string, learningUse: string): AnalystMemoryObservation {
  return {
    key,
    label: TRACK_LABELS[key],
    observation: detail,
    learningUse,
  }
}

export function buildAnalystMemoryTracker(tasks: AnalystTask[]): AnalystMemoryTracker {
  const hasSystems = tasks.some(task => task.lane === 'systems')
  const hasMarket = tasks.some(task => task.lane === 'market')
  const hasOperations = tasks.some(task => task.lane === 'operations')

  return {
    mode: 'session_foundation',
    writePolicy: 'commander_approved_only',
    observations: [
      observation(
        'project_success_failure',
        'Compare completed project outcomes against Commander success criteria before reusing a strategy.',
        'Promote strategies that repeatedly ship with approval clarity and low repair burden.',
      ),
      observation(
        'provider_effectiveness',
        hasSystems
          ? 'Track provider/model response quality, timeout pressure, and synthesis usefulness.'
          : 'Provider comparison is available when a systems lane is included.',
        'Route future work toward providers with reliable, evidence-backed outputs.',
      ),
      observation(
        'repair_frequency',
        'Repeated repairs are treated as system feedback, not isolated annoyance.',
        'Escalate recurring repair clusters to Red Team and engineering bridge review.',
      ),
      observation(
        'approval_outcomes',
        'Approval, pause, redirect, and deeper-work decisions become outcome labels for later comparison.',
        'Improve future packets by learning which approval paths produce better decisions.',
      ),
      observation(
        'retrieval_success',
        'Retrieval success is tracked separately from model confidence.',
        'Block final intelligence claims when retrieval freshness or source integrity is unknown.',
      ),
      observation(
        'latency_performance',
        hasSystems ? 'Latency/performance observations feed systems and operations scoring.' : 'Latency is retained as a future systems metric.',
        'Identify slow families, providers, or workflow phases before they become hidden bottlenecks.',
      ),
      observation(
        'operational_improvements',
        hasOperations ? 'Operational improvements are tied to workflow impact, not generic suggestions.' : 'Operations lane can be added for deeper throughput review.',
        'Compare changes against before/after approval speed, repair rate, and delivery quality.',
      ),
      observation(
        'recurring_problems',
        'Recurring failures are tagged for historical comparison and Red Team verification.',
        'Prevent repeat failure loops from being reframed as new problems every session.',
      ),
      observation(
        'market_news_pattern_changes',
        hasMarket ? 'Market/news changes require source freshness before synthesis.' : 'Market/news monitoring remains dormant until requested or project-relevant.',
        'Separate durable trend changes from one-off noise.',
      ),
    ],
    recurringSuccessPatterns: [
      'Clear Commander scope plus explicit approval gates improves downstream decision quality.',
      'Evidence retrieval before synthesis lowers false confidence in market and intelligence claims.',
      'Red Team review before final approval catches boundary drift and hidden assumptions.',
    ],
    recurringFailureSignals: [
      'High confidence with missing source freshness.',
      'Repeated repair on the same subsystem without a root-cause note.',
      'External action implied before Commander approval.',
      'Forecast language without uncertainty or data-gap disclosure.',
    ],
    historicalComparisonSummary:
      'Analyst memory is prepared as a learning surface for prior outcomes, recurring successful patterns, recurring failures, and provider/workflow performance. Persistence or external follow-up remains approval-gated.',
    nonAutonomousBoundary:
      'Analyst learning produces briefing context only; it does not trigger autonomous retrieval, execution, messaging, purchases, commits, pushes, or deployments.',
  }
}
