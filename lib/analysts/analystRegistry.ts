export type AnalystLane =
  | 'financial'
  | 'operations'
  | 'intelligence'
  | 'market'
  | 'logistics'
  | 'systems'
  | 'forecast'
  | 'risk'

export type AnalystCapability =
  | 'outcome_comparison'
  | 'trend_detection'
  | 'forecast_support'
  | 'operational_metrics'
  | 'financial_analysis'
  | 'opportunity_scoring'
  | 'intelligence_synthesis'
  | 'historical_comparison'
  | 'kpi_tracking'
  | 'anomaly_detection'
  | 'provider_comparison'
  | 'workflow_performance'
  | 'bottleneck_detection'
  | 'source_reliability'

export type AnalystFamilyProfile = {
  lane: AnalystLane
  label: string
  family: string
  role: string
  capabilities: AnalystCapability[]
  defaultQuestions: string[]
  hardBoundaries: string[]
}

const ANALYST_BOUNDARIES = [
  'Read, interpret, compare, score, and brief only.',
  'No autonomous external actions, purchases, outreach, deploys, commits, pushes, or file mutation.',
  'Escalate execution, retrieval, legal reliance, or external action through Commander approval gates.',
] as const

export const ANALYST_LANE_LABELS: Record<AnalystLane, string> = {
  financial: 'Financial Analyst',
  operations: 'Operations Analyst',
  intelligence: 'Intelligence Analyst',
  market: 'Market Analyst',
  logistics: 'Logistics Analyst',
  systems: 'Systems Analyst',
  forecast: 'Forecast Analyst',
  risk: 'Risk Analyst',
}

export const ANALYST_REGISTRY: Record<AnalystLane, AnalystFamilyProfile> = {
  financial: {
    lane: 'financial',
    label: ANALYST_LANE_LABELS.financial,
    family: 'Analyst / Financial',
    role: 'Revenue, cost, ROI, opportunity quality, and financial exposure interpretation.',
    capabilities: ['financial_analysis', 'opportunity_scoring', 'historical_comparison', 'kpi_tracking'],
    defaultQuestions: ['Where is money moving?', 'Which opportunities have the best risk-adjusted upside?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  operations: {
    lane: 'operations',
    label: ANALYST_LANE_LABELS.operations,
    family: 'Analyst / Operations',
    role: 'Workflow throughput, handoff friction, operating cadence, and execution bottleneck interpretation.',
    capabilities: ['operational_metrics', 'workflow_performance', 'bottleneck_detection', 'kpi_tracking'],
    defaultQuestions: ['Where is the workflow slowing down?', 'Which operating changes improve decision quality?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  intelligence: {
    lane: 'intelligence',
    label: ANALYST_LANE_LABELS.intelligence,
    family: 'Analyst / Intelligence',
    role: 'Signal synthesis, source reliability, pattern shifts, and data-gap briefing.',
    capabilities: ['intelligence_synthesis', 'trend_detection', 'source_reliability', 'anomaly_detection'],
    defaultQuestions: ['Which signals are reliable?', 'What changed compared with prior observations?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  market: {
    lane: 'market',
    label: ANALYST_LANE_LABELS.market,
    family: 'Analyst / Market',
    role: 'Market/news pattern changes, competitive movement, demand signals, and timing windows.',
    capabilities: ['trend_detection', 'forecast_support', 'opportunity_scoring', 'intelligence_synthesis'],
    defaultQuestions: ['What market pattern is changing?', 'Which opportunity window is opening or closing?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  logistics: {
    lane: 'logistics',
    label: ANALYST_LANE_LABELS.logistics,
    family: 'Analyst / Logistics',
    role: 'Resource movement, dependencies, lead time, routing, and delivery constraints.',
    capabilities: ['workflow_performance', 'bottleneck_detection', 'operational_metrics', 'forecast_support'],
    defaultQuestions: ['Which dependency blocks flow?', 'What resource timing creates risk?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  systems: {
    lane: 'systems',
    label: ANALYST_LANE_LABELS.systems,
    family: 'Analyst / Systems',
    role: 'Runtime performance, provider effectiveness, repair frequency, retrieval success, and system feedback loops.',
    capabilities: ['provider_comparison', 'workflow_performance', 'anomaly_detection', 'kpi_tracking'],
    defaultQuestions: ['Which provider or subsystem is improving outcomes?', 'Where is repeat repair showing a system problem?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  forecast: {
    lane: 'forecast',
    label: ANALYST_LANE_LABELS.forecast,
    family: 'Analyst / Forecast',
    role: 'Scenario framing, trajectory comparison, uncertainty ranges, and forecast caveats.',
    capabilities: ['forecast_support', 'trend_detection', 'historical_comparison', 'opportunity_scoring'],
    defaultQuestions: ['Which path is most likely?', 'What uncertainty can change the forecast?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
  risk: {
    lane: 'risk',
    label: ANALYST_LANE_LABELS.risk,
    family: 'Analyst / Risk',
    role: 'Volatility, downside exposure, anomaly alerts, and Red Team-compatible risk framing.',
    capabilities: ['anomaly_detection', 'historical_comparison', 'workflow_performance', 'trend_detection'],
    defaultQuestions: ['What can fail repeatedly?', 'Which risk is being underweighted?'],
    hardBoundaries: [...ANALYST_BOUNDARIES],
  },
}

export const ANALYST_LANES = Object.keys(ANALYST_REGISTRY) as AnalystLane[]
