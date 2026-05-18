import type {
  HighestLeverageMove,
  RevenueEngineCategory,
  RevenueExecutionPattern,
  RevenueMetricKey,
  RevenueOpportunity,
  RevenueOpportunityInput,
  RevenueScoreBreakdown,
  RevenueStrategicAlert,
} from './model'

const DEFAULT_ACTIONS: Record<RevenueEngineCategory, string> = {
  freight: 'Collect lane, shipper, deadhead, and payout evidence before contacting anyone.',
  sprinter_van_routes: 'Compare route payout, loaded miles, deadhead, insurance, and schedule impact.',
  local_delivery: 'Validate recurring local demand, stop density, and family schedule fit.',
  smb_automation: 'Interview one SMB owner about repetitive admin pain before proposing a build.',
  ai_operations: 'Identify a manual AI ops workflow with repeat volume and clear quality checks.',
  call_center_customer_operations: 'Map intake, call routing, follow-up, and QA friction before offering help.',
  scheduling_intake_systems: 'Document current booking/intake steps and where no-show leakage happens.',
  ai_tooling: 'Define the smallest paid workflow tool and the manual service it replaces.',
  consulting: 'Package one specific outcome, price anchor, and proof requirement before outreach.',
  agency_services: 'Choose one repeatable service model with delivery checklist and approval gate.',
  app_factory_ideas: 'Score build effort, buyer pain, and reuse potential before coding.',
  data_annotation_evaluation: 'Check pay rate, task quality rules, payout terms, and fatigue risk.',
  operational_dashboards: 'Find a recurring reporting pain with a buyer and manual spreadsheet replacement.',
}

const CATEGORY_BASE: Record<RevenueEngineCategory, Partial<Record<RevenueMetricKey, number>>> = {
  freight: { urgency: 76, timeToProfit: 68, repeatability: 62, stressLoad: 64, familyImpact: 48 },
  sprinter_van_routes: { urgency: 78, timeToProfit: 72, repeatability: 70, stressLoad: 70, familyImpact: 44 },
  local_delivery: { urgency: 66, timeToProfit: 70, repeatability: 64, stressLoad: 58, familyImpact: 54 },
  smb_automation: { scalability: 78, automationPotential: 86, repeatability: 76, strategicAlignment: 82, longTermCompoundingValue: 84 },
  ai_operations: { scalability: 76, automationPotential: 82, repeatability: 74, strategicAlignment: 80, longTermCompoundingValue: 78 },
  call_center_customer_operations: { repeatability: 78, automationPotential: 72, strategicAlignment: 74, stressLoad: 52 },
  scheduling_intake_systems: { repeatability: 82, automationPotential: 80, scalability: 72, strategicAlignment: 76 },
  ai_tooling: { scalability: 82, automationPotential: 84, longTermCompoundingValue: 86, timeToProfit: 48 },
  consulting: { timeToProfit: 74, startupCost: 86, repeatability: 58, scalability: 48 },
  agency_services: { timeToProfit: 66, repeatability: 76, scalability: 68, stressLoad: 58 },
  app_factory_ideas: { scalability: 78, automationPotential: 72, longTermCompoundingValue: 88, timeToProfit: 36 },
  data_annotation_evaluation: { timeToProfit: 76, startupCost: 90, scalability: 32, repeatability: 48, stressLoad: 62 },
  operational_dashboards: { repeatability: 80, automationPotential: 78, scalability: 74, strategicAlignment: 78 },
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function compact(value: string, limit = 260): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

function scoreFromCost(startupCostUsd: number | null | undefined): number {
  if (startupCostUsd == null) return 68
  if (startupCostUsd <= 50) return 92
  if (startupCostUsd <= 250) return 82
  if (startupCostUsd <= 1000) return 60
  if (startupCostUsd <= 5000) return 42
  return 25
}

function scoreFromTime(estimatedTimeHours: number | null | undefined): number {
  if (estimatedTimeHours == null) return 58
  if (estimatedTimeHours <= 4) return 90
  if (estimatedTimeHours <= 12) return 76
  if (estimatedTimeHours <= 40) return 58
  if (estimatedTimeHours <= 120) return 38
  return 22
}

export function scoreRevenueOpportunity(input: RevenueOpportunityInput): RevenueScoreBreakdown {
  const base = CATEGORY_BASE[input.category]
  const scores = input.scores ?? {}
  const metric = (key: Exclude<RevenueMetricKey, 'leverageScore'>, fallback: number) =>
    clampScore(scores[key] ?? base[key] ?? fallback)

  const confidence = metric('confidence', input.source ? 66 : 48)
  const urgency = metric('urgency', 58)
  const startupCost = metric('startupCost', scoreFromCost(input.startupCostUsd))
  const scalability = metric('scalability', 58)
  const automationPotential = metric('automationPotential', 60)
  const repeatability = metric('repeatability', 62)
  const timeToProfit = metric('timeToProfit', scoreFromTime(input.estimatedTimeHours))
  const strategicAlignment = metric('strategicAlignment', 66)
  const stressLoad = metric('stressLoad', 52)
  const familyImpact = metric('familyImpact', 62)
  const longTermCompoundingValue = metric('longTermCompoundingValue', 64)
  const revenueBoost = input.estimatedRevenue ? Math.min(8, Math.log10(Math.max(10, input.estimatedRevenue)) * 2) : 0

  const leverageScore = clampScore(
    confidence * 0.12 +
    urgency * 0.1 +
    startupCost * 0.09 +
    scalability * 0.13 +
    automationPotential * 0.12 +
    repeatability * 0.13 +
    timeToProfit * 0.11 +
    strategicAlignment * 0.11 +
    familyImpact * 0.05 +
    longTermCompoundingValue * 0.12 -
    stressLoad * 0.08 +
    revenueBoost,
  )

  return {
    leverageScore,
    confidence,
    urgency,
    startupCost,
    scalability,
    automationPotential,
    repeatability,
    timeToProfit,
    strategicAlignment,
    stressLoad,
    familyImpact,
    longTermCompoundingValue,
  }
}

export function familyImpactEstimate(score: RevenueScoreBreakdown): RevenueOpportunity['familyImpactEstimate'] {
  if (score.stressLoad >= 76 || score.familyImpact < 42) return 'high_stress'
  if (score.stressLoad >= 62 || score.familyImpact < 55) return 'watch'
  if (score.familyImpact >= 72 && score.stressLoad <= 52) return 'positive'
  return 'neutral'
}

export function buildRevenueOpportunity(input: RevenueOpportunityInput, now = new Date()): RevenueOpportunity {
  const score = scoreRevenueOpportunity(input)
  const title = compact(input.title, 180) || 'Untitled revenue opportunity'
  return {
    id: `rev-${now.getTime()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'opportunity'}`,
    title,
    category: input.category,
    status: 'ready_for_review',
    source: compact(input.source || 'Commander-entered revenue engine note', 180),
    notes: compact(input.notes || 'No detailed notes captured yet.', 1200),
    estimatedRevenue: input.estimatedRevenue ?? null,
    estimatedTimeHours: input.estimatedTimeHours ?? null,
    startupCostUsd: input.startupCostUsd ?? null,
    regionalSignal: input.regionalSignal ? compact(input.regionalSignal, 400) : null,
    shipperPainPoint: input.shipperPainPoint ? compact(input.shipperPainPoint, 400) : null,
    smbPainPoint: input.smbPainPoint ? compact(input.smbPainPoint, 400) : null,
    nextReviewAction: compact(input.nextReviewAction || DEFAULT_ACTIONS[input.category], 420),
    score,
    priorityRank: 0,
    familyImpactEstimate: familyImpactEstimate(score),
    guardrails: {
      recommendationOnly: true,
      approvalRequired: true,
      externalExecutionAllowed: false,
      hiddenExecutionAllowed: false,
      incomeClaimed: false,
    },
    createdAt: now.toISOString(),
    updatedAt: null,
    metadata: {
      estimatedOnly: true,
      approvalGate: 'commander_required',
      noExternalExecution: true,
    },
  }
}

export function rankRevenueOpportunities(opportunities: RevenueOpportunity[]): RevenueOpportunity[] {
  return [...opportunities]
    .sort((a, b) => b.score.leverageScore - a.score.leverageScore)
    .map((opportunity, index) => ({ ...opportunity, priorityRank: index + 1 }))
}

export function highestLeverageMove(opportunities: RevenueOpportunity[]): HighestLeverageMove {
  const ranked = rankRevenueOpportunities(opportunities.filter(opportunity => !['won', 'lost', 'archived'].includes(opportunity.status)))
  const top = ranked[0]
  if (!top) {
    return {
      title: 'Capture one source-backed revenue opportunity',
      summary: 'No active opportunity is available. Add a concrete freight, SMB automation, AI ops, or app factory opportunity with evidence before taking action.',
      opportunityId: null,
      score: 0,
      whyNow: 'The engine needs a visible opportunity record before it can rank attention.',
      nextManualAction: 'Enter an opportunity with source, estimated time, cost, and review action.',
      approvalRequired: true,
      canExecute: false,
    }
  }

  return {
    title: top.title,
    summary: `Estimated leverage score ${top.score.leverageScore}. Category ${top.category.replace(/_/g, ' ')}. No revenue is claimed; this is a prioritization recommendation.`,
    opportunityId: top.id,
    score: top.score.leverageScore,
    whyNow: [
      top.score.timeToProfit >= 70 ? 'fast-to-revenue' : null,
      top.score.repeatability >= 70 ? 'repeatable' : null,
      top.score.automationPotential >= 70 ? 'automation-friendly' : null,
      top.score.longTermCompoundingValue >= 70 ? 'compounding' : null,
      top.score.stressLoad <= 55 ? 'low-friction' : 'stress requires review',
    ].filter(Boolean).join(', '),
    nextManualAction: top.nextReviewAction,
    approvalRequired: true,
    canExecute: false,
  }
}

export function buildExecutionPatterns(opportunities: RevenueOpportunity[]): RevenueExecutionPattern[] {
  const ranked = rankRevenueOpportunities(opportunities)
  const now = new Date().toISOString()
  const patterns: RevenueExecutionPattern[] = []
  const repeatable = ranked.find(item => item.score.repeatability >= 75 && item.score.leverageScore >= 65)
  const bottleneck = ranked.find(item => item.score.stressLoad >= 70 || item.score.startupCost <= 40)
  const lowRoi = ranked.find(item => item.score.leverageScore < 45 || (item.score.stressLoad >= 68 && item.score.timeToProfit < 50))
  const compounding = ranked.find(item => item.score.longTermCompoundingValue >= 78 && item.score.automationPotential >= 72)

  if (repeatable) {
    patterns.push(pattern('profitable_repeat', repeatable.category, `Repeatable model: ${repeatable.title}`, 'This opportunity has high repeatability and leverage estimates; review it as a packaged service or reusable workflow.', 0.72, now))
  }
  if (bottleneck) {
    patterns.push(pattern('bottleneck', bottleneck.category, `Execution bottleneck: ${bottleneck.title}`, 'High stress or startup friction may lower income per unit of attention unless the next action is narrowed.', 0.68, now))
  }
  if (lowRoi) {
    patterns.push(pattern('low_roi', lowRoi.category, `Low-ROI watch: ${lowRoi.title}`, 'This looks like a distraction risk until better evidence, pricing, or repeatability is captured.', 0.66, now))
  }
  if (compounding) {
    patterns.push(pattern('compounding_asset', compounding.category, `Compounding asset: ${compounding.title}`, 'This opportunity may compound as a reusable system, dashboard, app, or workflow service after validation.', 0.7, now))
  }

  return patterns
}

function pattern(
  patternType: RevenueExecutionPattern['patternType'],
  category: RevenueEngineCategory,
  title: string,
  summary: string,
  confidence: number,
  createdAt: string,
): RevenueExecutionPattern {
  return {
    id: `${patternType}-${category}`,
    category,
    patternType,
    title,
    summary,
    confidence,
    approvalRequired: true,
    canExecute: false,
    createdAt,
  }
}

export function buildStrategicAlerts(opportunities: RevenueOpportunity[], patterns: RevenueExecutionPattern[]): RevenueStrategicAlert[] {
  const ranked = rankRevenueOpportunities(opportunities)
  const alerts: RevenueStrategicAlert[] = []
  const high = ranked.find(item => item.score.leverageScore >= 72)
  const low = ranked.find(item => item.score.leverageScore < 45)
  const stress = ranked.find(item => item.score.stressLoad >= 72)
  const compounding = patterns.find(item => item.patternType === 'compounding_asset')

  if (high) {
    alerts.push(alert('high_opportunity', 'important', 'High-opportunity review available', `${high.title} has estimated leverage ${high.score.leverageScore}; review evidence before any spend or outreach.`, high.source))
  }
  if (low) {
    alerts.push(alert('low_roi_warning', 'watch', 'Low-ROI distraction risk', `${low.title} has low estimated leverage. Capture stronger proof or pause it.`, low.source))
  }
  if (stress) {
    alerts.push(alert('execution_bottleneck', 'important', 'Execution bottleneck warning', `${stress.title} carries high stress load. Narrow the manual next step before approval.`, stress.source))
  }
  if (compounding) {
    alerts.push(alert('compounding_opportunity', 'info', 'Compounding opportunity', compounding.summary, compounding.title))
  }

  alerts.push(alert('distraction_warning', 'watch', 'Recommendation-only boundary', 'Revenue Engine does not execute outreach, dispatch, filesystem mutation, shell commands, deployments, or income claims.', 'Phase 13 guardrail'))
  return alerts
}

function alert(
  kind: RevenueStrategicAlert['kind'],
  severity: RevenueStrategicAlert['severity'],
  title: string,
  summary: string,
  sourceAttribution: string,
): RevenueStrategicAlert {
  return {
    id: `${kind}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`,
    kind,
    severity,
    title,
    summary,
    sourceAttribution,
    approvalRequired: true,
    canExecute: false,
  }
}

export function seedRevenueOpportunities(now = new Date()): RevenueOpportunity[] {
  return rankRevenueOpportunities([
    buildRevenueOpportunity({
      title: 'Ohio sprinter van recurring route watchlist',
      category: 'sprinter_van_routes',
      notes: 'Track local lanes, route density, deadhead, payout range, schedule friction, and shipper pain before committing resources.',
      source: 'Static Phase 13 seed; requires sourced market validation.',
      estimatedRevenue: 800,
      estimatedTimeHours: 10,
      startupCostUsd: 250,
      regionalSignal: 'Ohio/local market signal placeholder. No live freight board or shipper data has been queried.',
      shipperPainPoint: 'Recurring small-load reliability, appointment windows, and rapid exception communication.',
    }, now),
    buildRevenueOpportunity({
      title: 'SMB missed-call and intake automation package',
      category: 'scheduling_intake_systems',
      notes: 'Package intake triage, booking follow-up, FAQ automation, and dashboard visibility as a narrow service offer.',
      source: 'Static Phase 13 seed; validate with one real SMB workflow interview.',
      estimatedRevenue: 1500,
      estimatedTimeHours: 12,
      startupCostUsd: 50,
      smbPainPoint: 'Missed calls, duplicated intake, slow follow-up, no dashboard for owner visibility.',
    }, now),
    buildRevenueOpportunity({
      title: 'AI evaluation and data annotation payout screen',
      category: 'data_annotation_evaluation',
      notes: 'Use only as a near-term cashflow option when payout terms, fatigue load, and hourly rate are visible.',
      source: 'Static Phase 13 seed; no platform claim or payout claim.',
      estimatedRevenue: 300,
      estimatedTimeHours: 20,
      startupCostUsd: 0,
      nextReviewAction: 'Verify task availability, payout terms, quality rules, and fatigue cost before prioritizing.',
    }, now),
  ])
}

