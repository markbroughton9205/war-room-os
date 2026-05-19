import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { FAMILY_SPECIALIZATIONS, specializationForFamily } from '@/lib/provider-specialization/roles'

export type CouncilTaskType =
  | 'signal_intake'
  | 'research'
  | 'revenue'
  | 'risk_review'
  | 'synthesis'
  | 'red_team_challenge'
  | 'general'

const TASK_KEYWORDS: Record<CouncilTaskType, RegExp> = {
  signal_intake: /\b(signal|rss|radar|intel|headline)\b/i,
  research: /\b(research|investigate|source|evidence)\b/i,
  revenue: /\b(revenue|income|money|monetiz|pricing)\b/i,
  risk_review: /\b(risk|threat|vulnerab|compliance)\b/i,
  synthesis: /\b(synthes|summar|converge|align|compare)\b/i,
  red_team_challenge: /\b(challenge|red team|adversar|contradict)\b/i,
  general: /.^/,
}

export function inferCouncilTaskType(text: string): CouncilTaskType {
  const normalized = (text ?? '').trim()
  for (const type of Object.keys(TASK_KEYWORDS) as CouncilTaskType[]) {
    if (type === 'general') continue
    if (TASK_KEYWORDS[type].test(normalized)) return type
  }
  return 'general'
}

const TASK_ROUTE_ORDER: Record<CouncilTaskType, CouncilOrchestrationFamily[]> = {
  signal_intake: ['grok', 'gemini', 'claude', 'chatgpt'],
  research: ['gemini', 'claude', 'grok', 'chatgpt'],
  revenue: ['chatgpt', 'grok', 'gemini', 'claude'],
  risk_review: ['claude', 'red_team', 'grok'],
  synthesis: ['gemini', 'chatgpt', 'claude', 'grok'],
  red_team_challenge: ['red_team', 'claude', 'grok'],
  general: ['chatgpt', 'claude', 'grok', 'gemini'],
}

export function routeFamiliesForTask(
  taskType: CouncilTaskType,
  opts?: { includeRedTeam?: boolean; maxFamilies?: number },
): CouncilOrchestrationFamily[] {
  const base = [...(TASK_ROUTE_ORDER[taskType] ?? TASK_ROUTE_ORDER.general)]
  const max = Math.min(Math.max(1, opts?.maxFamilies ?? 4), 6)
  const ordered: CouncilOrchestrationFamily[] = []
  for (const family of base) {
    if (!ordered.includes(family)) ordered.push(family)
  }
  if (opts?.includeRedTeam && !ordered.includes('red_team')) ordered.push('red_team')
  return ordered.slice(0, max)
}

export function scoreFamilyForTask(family: CouncilOrchestrationFamily, taskType: CouncilTaskType): number {
  const spec = specializationForFamily(family)
  const keywords = TASK_KEYWORDS[taskType].source.replace(/\\b|\\^|\\$/g, '').split('|').filter(Boolean)
  let score = 0.2
  for (const kw of keywords) {
    if (spec.taskAffinity.some(a => a.includes(kw.replace(/\\/g, '')))) score += 0.25
  }
  if (taskType === 'red_team_challenge' && spec.role === 'red_team') score += 0.5
  if (taskType === 'signal_intake' && spec.role === 'signals') score += 0.5
  if (taskType === 'revenue' && spec.role === 'revenue') score += 0.5
  if (taskType === 'synthesis' && spec.role === 'synthesis') score += 0.5
  return Math.min(1, score)
}

export function rankedFamiliesForDecree(decree: string, maxFamilies = 4): CouncilOrchestrationFamily[] {
  const taskType = inferCouncilTaskType(decree)
  const candidates = FAMILY_SPECIALIZATIONS.map(s => s.family)
  return candidates
    .map(family => ({ family, score: scoreFamilyForTask(family, taskType) }))
    .sort((a, b) => b.score - a.score)
    .map(row => row.family)
    .filter((family, index, arr) => arr.indexOf(family) === index)
    .slice(0, maxFamilies)
}
