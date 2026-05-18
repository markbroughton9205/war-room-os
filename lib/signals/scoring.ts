import type { BabySignalFamily, SignalCategory, SignalRawItem, SignalResult, SignalScores } from './model'

const CATEGORY_DEFAULTS: Record<SignalCategory, Partial<SignalScores>> = {
  freight: { incomePotential: 74, urgency: 68, startupCost: 48, timeToProfit: 64, repeatability: 70, strategicAlignment: 72, familyImpact: 48 },
  sprinter_van: { incomePotential: 72, urgency: 70, startupCost: 42, timeToProfit: 68, repeatability: 68, strategicAlignment: 68, familyImpact: 44 },
  local_delivery: { incomePotential: 62, urgency: 62, startupCost: 68, timeToProfit: 70, repeatability: 58, strategicAlignment: 58, familyImpact: 56 },
  load_board: { incomePotential: 70, urgency: 76, startupCost: 52, timeToProfit: 72, repeatability: 54, strategicAlignment: 60, familyImpact: 42 },
  job: { incomePotential: 58, urgency: 64, startupCost: 88, timeToProfit: 62, repeatability: 42, strategicAlignment: 44, familyImpact: 58 },
  gig: { incomePotential: 54, urgency: 72, startupCost: 90, timeToProfit: 76, repeatability: 44, strategicAlignment: 48, familyImpact: 54 },
  data_annotation: { incomePotential: 46, urgency: 68, startupCost: 92, timeToProfit: 74, repeatability: 46, strategicAlignment: 56, familyImpact: 48 },
  AI_evaluation: { incomePotential: 56, urgency: 70, startupCost: 90, timeToProfit: 72, repeatability: 52, strategicAlignment: 68, familyImpact: 52 },
  SMB_automation: { incomePotential: 78, urgency: 62, startupCost: 84, timeToProfit: 58, repeatability: 78, strategicAlignment: 84, familyImpact: 70 },
  customer_operations: { incomePotential: 70, urgency: 66, startupCost: 82, timeToProfit: 64, repeatability: 76, strategicAlignment: 76, familyImpact: 68 },
  call_center: { incomePotential: 62, urgency: 68, startupCost: 84, timeToProfit: 66, repeatability: 62, strategicAlignment: 62, familyImpact: 54 },
  AI_trends: { incomePotential: 66, urgency: 54, startupCost: 86, timeToProfit: 42, repeatability: 72, strategicAlignment: 82, familyImpact: 68 },
  local_Akron: { incomePotential: 58, urgency: 58, startupCost: 80, timeToProfit: 56, repeatability: 56, strategicAlignment: 70, familyImpact: 74 },
  Ohio_business: { incomePotential: 62, urgency: 58, startupCost: 76, timeToProfit: 58, repeatability: 62, strategicAlignment: 72, familyImpact: 70 },
  economic_warning: { incomePotential: 34, urgency: 82, startupCost: 70, timeToProfit: 32, repeatability: 38, strategicAlignment: 66, familyImpact: 76 },
  app_factory_opportunity: { incomePotential: 72, urgency: 48, startupCost: 84, timeToProfit: 38, repeatability: 78, strategicAlignment: 86, familyImpact: 72 },
}

const CATEGORY_KEYWORDS: Array<[SignalCategory, RegExp]> = [
  ['freight', /\bfreight|shipper|carrier|logistics|truck|transport\b/i],
  ['sprinter_van', /\bsprinter|cargo van|van route|expedite\b/i],
  ['local_delivery', /\blocal delivery|courier|last mile|route\b/i],
  ['load_board', /\bload board|loads|lane|deadhead|DAT\b/i],
  ['job', /\bjob|hiring|position|career|employment\b/i],
  ['gig', /\bgig|contract|freelance|task|marketplace\b/i],
  ['data_annotation', /\bdata annotation|labeling|annotation\b/i],
  ['AI_evaluation', /\bAI evaluation|eval|RLHF|model evaluation|quality rating\b/i],
  ['SMB_automation', /\bSMB|small business|automation|workflow|Zapier|CRM\b/i],
  ['customer_operations', /\bcustomer operations|support|intake|follow-up|booking|missed call\b/i],
  ['call_center', /\bcall center|inbound|outbound|phone support\b/i],
  ['AI_trends', /\bAI|agent|model|OpenAI|Anthropic|automation\b/i],
  ['local_Akron', /\bAkron|Summit County|Northeast Ohio\b/i],
  ['Ohio_business', /\bOhio|Cleveland|Columbus|business|grant|workforce\b/i],
  ['economic_warning', /\bwarning|layoff|shortage|closure|slowdown|risk|inflation\b/i],
  ['app_factory_opportunity', /\bapp|tool|software|dashboard|SaaS|workflow product\b/i],
]

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function compact(value: string, limit = 280): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'signal'
}

function pickCategory(item: SignalRawItem): SignalCategory {
  const text = `${item.title} ${item.summary}`
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? item.categories[0] ?? 'SMB_automation'
}

function assignedFamily(category: SignalCategory, scores: SignalScores): BabySignalFamily {
  if (scores.confidence < 45 || category === 'economic_warning') return 'Red Team Baby'
  if (category === 'AI_trends') return 'Grok Family Baby'
  if (category === 'app_factory_opportunity') return 'Feature Builder'
  if (['freight', 'sprinter_van', 'local_delivery', 'load_board', 'job', 'gig', 'data_annotation', 'AI_evaluation'].includes(category)) return 'Income Operations Baby'
  if (['SMB_automation', 'customer_operations', 'call_center'].includes(category)) return 'Analyst Baby'
  return 'Claude Family Baby'
}

function startupEstimate(category: SignalCategory): string {
  if (['job', 'gig', 'data_annotation', 'AI_evaluation'].includes(category)) return '$0-$100'
  if (['SMB_automation', 'customer_operations', 'call_center', 'AI_trends', 'app_factory_opportunity'].includes(category)) return '$0-$250'
  if (['freight', 'sprinter_van', 'local_delivery', 'load_board'].includes(category)) return '$250-$2,500 before insurance/equipment review'
  return '$0-$500'
}

function timeEstimate(category: SignalCategory): string {
  if (['job', 'gig', 'data_annotation', 'AI_evaluation', 'local_delivery'].includes(category)) return '1-7 days after manual verification'
  if (['SMB_automation', 'customer_operations', 'call_center'].includes(category)) return '1-3 weeks after one buyer workflow interview'
  if (['freight', 'sprinter_van', 'load_board'].includes(category)) return '3-14 days after lane, insurance, and payout validation'
  if (category === 'app_factory_opportunity') return '2-6 weeks after product validation'
  return 'unknown until source evidence is reviewed'
}

function nextAction(category: SignalCategory, title: string): string {
  if (['freight', 'sprinter_van', 'local_delivery', 'load_board'].includes(category)) {
    return `Review lane/payout/insurance/deadhead evidence for "${title}" before any dispatch, spend, or shipper contact.`
  }
  if (['job', 'gig', 'data_annotation', 'AI_evaluation'].includes(category)) {
    return `Verify payout terms, task availability, fatigue load, and application requirements for "${title}" before applying.`
  }
  if (['SMB_automation', 'customer_operations', 'call_center'].includes(category)) {
    return `Manually inspect the buyer pain and define one no-outreach validation question for "${title}".`
  }
  if (category === 'app_factory_opportunity') {
    return `Turn "${title}" into a Feature Builder proposal only after confirming repeatable buyer pain.`
  }
  if (category === 'economic_warning') {
    return `Ask Red Team Baby to challenge assumptions around "${title}" before prioritizing any opportunity.`
  }
  return `Review source evidence for "${title}" before taking any external action.`
}

function relevanceFor(item: SignalRawItem, category: SignalCategory): number {
  const text = `${item.title} ${item.summary}`
  const matched = CATEGORY_KEYWORDS.filter(([, pattern]) => pattern.test(text)).length
  const categoryBoost = item.categories.includes(category) ? 14 : 0
  const urlBoost = item.url ? 10 : 0
  const summaryBoost = item.summary.length >= 120 ? 8 : 0
  return clampScore(42 + matched * 7 + categoryBoost + urlBoost + summaryBoost)
}

export function scoreSignalItem(item: SignalRawItem, scanId: string | null): SignalResult {
  const category = pickCategory(item)
  const defaults = CATEGORY_DEFAULTS[category]
  const relevance = relevanceFor(item, category)
  const providerConfidence = item.provider === 'guardian' ? 84
    : item.provider === 'newsapi' ? 78
      : item.provider === 'tavily' ? 72
        : item.provider === 'firecrawl' ? 74
          : item.provider === 'rss' ? 68
            : 58
  const rawScoreBoost = typeof item.rawScore === 'number' ? Math.min(12, Math.max(0, item.rawScore <= 1 ? item.rawScore * 12 : item.rawScore / 8)) : 0
  const confidence = clampScore(providerConfidence + rawScoreBoost + (item.summary.length > 180 ? 4 : -6))
  const incomePotential = clampScore((defaults.incomePotential ?? 55) + (relevance - 60) * 0.18)
  const urgency = clampScore(defaults.urgency ?? 55)
  const startupCost = clampScore(defaults.startupCost ?? 65)
  const timeToProfit = clampScore(defaults.timeToProfit ?? 55)
  const repeatability = clampScore(defaults.repeatability ?? 58)
  const strategicAlignment = clampScore(defaults.strategicAlignment ?? 62)
  const familyImpact = clampScore(defaults.familyImpact ?? 58)
  const highestLeverage = clampScore(
    incomePotential * 0.18 +
    timeToProfit * 0.15 +
    startupCost * 0.13 +
    repeatability * 0.14 +
    strategicAlignment * 0.14 +
    familyImpact * 0.08 +
    confidence * 0.13 +
    urgency * 0.05,
  )
  const scores: SignalScores = {
    relevance,
    incomePotential,
    urgency,
    confidence,
    startupCost,
    timeToProfit,
    repeatability,
    strategicAlignment,
    familyImpact,
    highestLeverage,
  }

  return {
    id: `sig-${slug(item.url)}-${slug(item.title).slice(0, 24)}`,
    scanId,
    title: compact(item.title, 180),
    source: item.sourceLabel,
    provider: item.provider,
    sourceKind: item.sourceKind,
    url: item.url,
    summary: compact(item.summary, 900),
    category,
    scores,
    startupCostEstimate: startupEstimate(category),
    timeToProfitEstimate: timeEstimate(category),
    recommendedNextAction: nextAction(category, compact(item.title, 120)),
    assignedBabyFamily: assignedFamily(category, scores),
    approvalStatus: confidence < 45 || relevance < 45 ? 'low_confidence' : 'pending_review',
    capturedAt: item.capturedAt,
    metadata: item.metadata ?? {},
    guardrails: {
      sourceBacked: true,
      recommendationOnly: true,
      approvalRequired: true,
      externalExecutionAllowed: false,
      hiddenExecutionAllowed: false,
      incomeClaimed: false,
    },
  }
}

export function dedupeAndRankSignals(results: SignalResult[]): SignalResult[] {
  const byUrl = new Map<string, SignalResult>()
  for (const result of results) {
    const key = result.url.toLowerCase()
    const previous = byUrl.get(key)
    if (!previous || result.scores.highestLeverage > previous.scores.highestLeverage) byUrl.set(key, result)
  }
  return [...byUrl.values()].sort((a, b) => b.scores.highestLeverage - a.scores.highestLeverage)
}
