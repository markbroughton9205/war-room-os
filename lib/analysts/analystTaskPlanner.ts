import type { AnalystLane } from './analystRegistry'

export type AnalystIntentDetection = {
  isAnalystIntent: boolean
  analysisType: string
  matchedSignals: string[]
  commanderIntent: string
}

export type AnalystIntake = {
  id: string
  sourceDecree: string
  commanderIntent: string
  analysisType: string
  createdAt: string
  matchedSignals: string[]
  hardPreserve: string[]
}

export type AnalystTaskStatus = 'planned' | 'assigned' | 'waiting_data' | 'completed' | 'blocked'

export type AnalystTask = {
  id: string
  lane: AnalystLane
  title: string
  objective: string
  assignedFamily: string
  requiredInputs: string[]
  status: AnalystTaskStatus
  outputSummary: string
  confidence: number
  risks: string[]
  approvalRequiredForAction: boolean
}

export const ANALYST_HARD_PRESERVE = [
  'Preserve runtime truth doctrine.',
  'Preserve Commander approval gates.',
  'Preserve repair ledger context.',
  'Preserve engineering bridge boundaries.',
  'Preserve intelligence packet integrity.',
  'Preserve Red Team verification.',
  'Analyst families assist Commander and project orchestration only.',
  'No autonomous external actions, commits, pushes, deploys, outreach, purchases, or legal reliance.',
] as const

const EXPLICIT_ANALYST_SIGNALS = [
  /\banaly[sz]e\b/i,
  /\banalysis\b/i,
  /\bforecast\b/i,
  /\bcompare\b/i,
  /\bscore\b/i,
  /\bevaluate\b/i,
  /\btrack\s+trends?\b/i,
  /\bfind\s+bottlenecks?\b/i,
  /\bmonitor\s+performance\b/i,
  /\bdetect\s+anomal/i,
  /\btrend\s+snapshot\b/i,
] as const

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function inferAnalysisType(text: string): string {
  if (/\bforecast\b/i.test(text)) return 'forecast and scenario analysis'
  if (/\bcompare\b|\bversus\b|\bvs\b/i.test(text)) return 'comparative outcome analysis'
  if (/\bscore\b|\brank\b/i.test(text)) return 'scoring and prioritization analysis'
  if (/\bbottleneck\b|\bworkflow\b|\bperformance\b/i.test(text)) return 'operational performance analysis'
  if (/\btrend\b|\bmonitor\b|\banomal/i.test(text)) return 'trend and anomaly analysis'
  return 'outcome intelligence analysis'
}

export function detectAnalystIntent(decree: string): AnalystIntentDetection {
  const clean = normalize(typeof decree === 'string' ? decree : '')
  if (!clean) {
    return { isAnalystIntent: false, analysisType: 'none', matchedSignals: [], commanderIntent: '' }
  }

  const matchedSignals = EXPLICIT_ANALYST_SIGNALS
    .filter(pattern => pattern.test(clean))
    .map(pattern => pattern.source)

  const hasAnalystObject = /\b(outcomes?|trends?|strateg(?:y|ies)|providers?|models?|workflow|performance|metrics?|kpis?|opportunit(?:y|ies)|risk|bottlenecks?|anomalies|market|news|latency|repair|approval|retrieval)\b/i.test(clean)
  const isAnalystIntent = matchedSignals.length > 0 && hasAnalystObject

  return {
    isAnalystIntent,
    analysisType: isAnalystIntent ? inferAnalysisType(clean) : 'none',
    matchedSignals,
    commanderIntent: clean,
  }
}

export function createAnalystIntake(
  decree: string,
  now = new Date(),
  options: { force?: boolean; analysisType?: string } = {},
): AnalystIntake | null {
  const detection = detectAnalystIntent(decree)
  if (!detection.isAnalystIntent && !options.force) return null

  const clean = normalize(decree)
  const analysisType = options.analysisType ?? (detection.isAnalystIntent ? detection.analysisType : inferAnalysisType(clean))
  const slug = analysisType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return {
    id: `analyst-${now.getTime()}-${slug || 'outcome-intelligence'}`,
    sourceDecree: clean,
    commanderIntent: detection.commanderIntent || clean,
    analysisType,
    createdAt: now.toISOString(),
    matchedSignals: detection.matchedSignals.length ? detection.matchedSignals : ['project_approval_analyst_support'],
    hardPreserve: [...ANALYST_HARD_PRESERVE],
  }
}
