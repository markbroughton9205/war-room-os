import { ANALYST_LANE_LABELS, type AnalystLane } from './analystRegistry'
import type { AnalystScoringSummary } from './analystScoring'
import type { AnalystIntake, AnalystTask } from './analystTaskPlanner'

export type AnalystFinding = {
  lane: AnalystLane
  title: string
  summary: string
  confidence: number
}

export type AnalystForecastCard = {
  title: string
  scenario: string
  confidence: number
  risk: string
}

export type AnalystHeatIndicator = {
  label: string
  state: 'cool' | 'watch' | 'hot'
  detail: string
}

export type AnalystReport = {
  title: string
  executiveSummary: string
  findings: AnalystFinding[]
  trendSnapshots: string[]
  scoringSummaries: string[]
  heatIndicators: AnalystHeatIndicator[]
  forecastCards: AnalystForecastCard[]
  bottlenecks: string[]
  anomalyAlerts: string[]
  dataGaps: string[]
  unknowns: string[]
  strategicOptions: Array<{ label: string; rank: number; rationale: string }>
  confidenceSummary: string
  nonAutonomousBoundary: string
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

function buildDataGaps(text: string): string[] {
  const gaps = [
    'Verified outcome history for this exact request is not attached to the packet.',
    'Live source freshness is unknown unless a retrieval lane runs and returns evidence.',
  ]
  if (includesAny(text, [/\brevenue|cost|roi|financial|payout\b/i])) {
    gaps.push('Financial figures require confirmed amounts, time window, and source of truth.')
  }
  if (includesAny(text, [/\bprovider|model|latency|performance\b/i])) {
    gaps.push('Provider/model comparison needs measured response quality, latency, failure, and cost data.')
  }
  if (includesAny(text, [/\bmarket|news|competitor\b/i])) {
    gaps.push('Market/news pattern changes require current sources and timestamped retrieval.')
  }
  return gaps
}

function buildBottlenecks(text: string): string[] {
  const bottlenecks = ['Approval timing can become a bottleneck if action packets do not separate analysis from execution.']
  if (includesAny(text, [/\brepair|bug|failure|fail\b/i])) {
    bottlenecks.push('Recurring repair without root-cause tagging can hide repeated system failures.')
  }
  if (includesAny(text, [/\bretrieval|source|evidence\b/i])) {
    bottlenecks.push('Evidence retrieval freshness can block trustworthy synthesis.')
  }
  if (includesAny(text, [/\bprovider|model|latency\b/i])) {
    bottlenecks.push('Provider latency or degraded response quality can slow council synthesis.')
  }
  return bottlenecks
}

function buildAnomalies(text: string): string[] {
  const alerts: string[] = []
  if (includesAny(text, [/\banomal|outlier|spike|drop\b/i])) {
    alerts.push('Commander requested anomaly review; analyst packet should separate signal from noise before recommendation.')
  }
  if (includesAny(text, [/\bhigh confidence|certain|guarantee\b/i])) {
    alerts.push('High-certainty language is an anomaly unless backed by runtime truth or verified evidence.')
  }
  if (includesAny(text, [/\bexternal|outreach|purchase|deploy|push|commit\b/i])) {
    alerts.push('External-action language detected; keep all analyst outputs behind approval boundaries.')
  }
  return alerts.length ? alerts : ['No acute anomaly proven from the decree alone; monitor after verified data arrives.']
}

export function buildAnalystReport(input: {
  intake: AnalystIntake
  tasks: AnalystTask[]
  scoring: AnalystScoringSummary
}): AnalystReport {
  const { intake, tasks, scoring } = input
  const text = intake.sourceDecree
  const dataGaps = buildDataGaps(text)
  const anomalyAlerts = buildAnomalies(text)

  return {
    title: `${intake.analysisType} packet`,
    executiveSummary:
      `Analyst families prepared outcome intelligence for ${intake.analysisType}. Findings are advisory and support Commander/project orchestration decisions; no external action is executed.`,
    findings: tasks.map(task => ({
      lane: task.lane,
      title: ANALYST_LANE_LABELS[task.lane],
      summary: task.outputSummary,
      confidence: task.confidence,
    })),
    trendSnapshots: [
      'Track project success/failure against Commander success criteria before repeating a strategy.',
      'Watch provider effectiveness, retrieval success, and repair frequency as separate operational signals.',
      'Treat approval outcomes as decision-quality feedback, not administrative noise.',
      includesAny(text, [/\bmarket|news\b/i])
        ? 'Market/news pattern changes require timestamped evidence before becoming strategy.'
        : 'Market/news monitoring remains available when current external signals are requested.',
    ],
    scoringSummaries: [
      `${scoring.confidence.label}: ${scoring.confidence.value}/100 (${scoring.confidence.band})`,
      `${scoring.opportunity.label}: ${scoring.opportunity.value}/100 (${scoring.opportunity.band})`,
      `${scoring.operationalImpact.label}: ${scoring.operationalImpact.value}/100 (${scoring.operationalImpact.band})`,
      `${scoring.volatilityRisk.label}: ${scoring.volatilityRisk.value}/100 (${scoring.volatilityRisk.band})`,
      `${scoring.sourceReliability.label}: ${scoring.sourceReliability.value}/100 (${scoring.sourceReliability.band})`,
    ],
    heatIndicators: [
      {
        label: 'Decision readiness',
        state: scoring.confidence.value >= 70 && dataGaps.length <= 2 ? 'hot' : 'watch',
        detail: scoring.confidence.rationale,
      },
      {
        label: 'Operational pressure',
        state: scoring.operationalImpact.value >= 75 ? 'hot' : scoring.operationalImpact.value >= 50 ? 'watch' : 'cool',
        detail: scoring.operationalImpact.rationale,
      },
      {
        label: 'Risk volatility',
        state: scoring.volatilityRisk.value >= 65 ? 'hot' : scoring.volatilityRisk.value >= 35 ? 'watch' : 'cool',
        detail: scoring.volatilityRisk.rationale,
      },
    ],
    forecastCards: [
      {
        title: 'Conservative path',
        scenario: 'Hold final recommendation until missing data and approval boundaries are clarified.',
        confidence: 0.76,
        risk: 'Slower decision cycle, lower false-confidence risk.',
      },
      {
        title: 'Focused lane path',
        scenario: 'Run only the relevant analyst lanes, then synthesize findings into a Commander approval packet.',
        confidence: 0.72,
        risk: 'Useful for speed, but may miss cross-lane dependencies.',
      },
      {
        title: 'Full intelligence path',
        scenario: 'Combine analyst findings with retrieval, Red Team verification, and project orchestration.',
        confidence: 0.68,
        risk: 'Best decision quality, higher latency and coordination cost.',
      },
    ],
    bottlenecks: buildBottlenecks(text),
    anomalyAlerts,
    dataGaps,
    unknowns: [
      'Actual historical project outcomes are available only when memory or persisted records are attached.',
      'Provider effectiveness cannot be finalized without measured runtime outcomes.',
      'Forecasts remain scenario support, not guarantees.',
    ],
    strategicOptions: [
      { label: 'Verify data before final recommendation', rank: 1, rationale: 'Best fit for intelligence packet integrity.' },
      { label: 'Run focused analyst lanes', rank: 2, rationale: 'Fastest way to reduce uncertainty while preserving approval gates.' },
      { label: 'Escalate to project orchestration', rank: 3, rationale: 'Use when findings imply coordinated engineering, research, or business work.' },
    ],
    confidenceSummary:
      `${scoring.confidence.value}/100 confidence with ${dataGaps.length} data gap(s), ${anomalyAlerts.length} anomaly alert(s), and risk scored ${scoring.volatilityRisk.value}/100.`,
    nonAutonomousBoundary:
      'Analyst lanes produce insight only. Commander approval remains required before external actions, repo changes, commits, pushes, deploys, purchases, outreach, or legal reliance.',
  }
}
