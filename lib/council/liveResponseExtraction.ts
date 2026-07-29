import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

type ProviderResultLike = {
  family?: string
  content?: string
  status?: string
  messageType?: string
  error?: string
}

export type CouncilResponsePayloadLike = {
  councilSingleResponse?: string
  councilSingleFamily?: CouncilOrchestrationFamily
  results?: ProviderResultLike[]
  familyDeliberation?: {
    turns?: Array<{
      turn_id?: unknown
      output_message_id?: unknown
      provider_family?: unknown
      provider_label?: unknown
      completion_status?: unknown
      full_response?: unknown
    }>
  }
}

export type ExtractedCouncilResponse = {
  content: string
  source: 'councilSingleResponse' | 'results.content' | 'familyDeliberation.turn'
  family: string | null
}

export type ExtractedCouncilContribution = {
  contributionId: string
  content: string
  source: 'results.content' | 'familyDeliberation.turn'
  family: string | null
  displayFamily: string | null
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function familyMatches(resultFamily: string, targetFamily?: CouncilOrchestrationFamily): boolean {
  if (!targetFamily) return true
  const family = resultFamily.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const target = targetFamily.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (family === target) return true
  if (target === 'chatgpt') return family.includes('chatgpt')
  if (target === 'claude') return family.includes('claude')
  if (target === 'redteam') return family.includes('redteam') || family === 'redteam'
  if (target === 'grok') return family.includes('grok')
  if (target === 'gemini') return family.includes('gemini')
  if (target === 'kimi') return family.includes('kimi')
  return family.includes(target)
}

function resultHasUsableProviderText(result: ProviderResultLike, targetFamily?: CouncilOrchestrationFamily): boolean {
  const content = normalized(result.content)
  if (content.length < 5) return false
  if (normalized(result.status).toUpperCase() !== 'OK') return false
  if (normalized(result.error)) return false
  if (normalized(result.messageType) === 'integrity_flag') return false
  const family = normalized(result.family)
  if (!family || family.toUpperCase() === 'SYSTEM') return false
  return familyMatches(family, targetFamily)
}

type DeliberationTurnLike = NonNullable<NonNullable<CouncilResponsePayloadLike['familyDeliberation']>['turns']>[number]

function deliberationTurns(payload: CouncilResponsePayloadLike): DeliberationTurnLike[] {
  const turns = payload.familyDeliberation?.turns
  return Array.isArray(turns) ? turns : []
}

function turnHasUsableProviderText(turn: DeliberationTurnLike, targetFamily?: CouncilOrchestrationFamily): boolean {
  const content = normalized(turn.full_response)
  if (content.length < 5) return false
  if (String(turn.completion_status ?? '').toLowerCase() !== 'complete') return false
  if (!targetFamily) return true
  return familyMatches(normalized(turn.provider_family), targetFamily) || familyMatches(normalized(turn.provider_label), targetFamily)
}

export function extractReadableCouncilResponse(
  payload: CouncilResponsePayloadLike,
  targetFamily?: CouncilOrchestrationFamily,
): ExtractedCouncilResponse | null {
  const direct = normalized(payload.councilSingleResponse)
  if (direct.length >= 5) {
    return {
      content: direct,
      source: 'councilSingleResponse',
      family: payload.councilSingleFamily ?? targetFamily ?? null,
    }
  }

  const result = (payload.results ?? []).find(row => resultHasUsableProviderText(row, targetFamily))
  if (result) {
    return {
      content: normalized(result.content),
      source: 'results.content',
      family: normalized(result.family) || targetFamily || null,
    }
  }

  const turn = deliberationTurns(payload).find(row => turnHasUsableProviderText(row, targetFamily))
  if (!turn) return null
  return {
    content: normalized(turn.full_response),
    source: 'familyDeliberation.turn',
    family: normalized(turn.provider_family) || normalized(turn.provider_label) || targetFamily || null,
  }
}

function contributionKey(input: {
  family?: unknown
  content?: unknown
  id?: unknown
  index: number
  source: ExtractedCouncilContribution['source']
}): string {
  const family = normalized(input.family).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'provider'
  const id = normalized(input.id).toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (id) return `${input.source}:${family}:${id}`
  const content = normalized(input.content).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80)
  return `${input.source}:${family}:${input.index}:${content}`
}

export function extractReadableCouncilContributions(
  payload: CouncilResponsePayloadLike,
  targetFamily?: CouncilOrchestrationFamily,
): ExtractedCouncilContribution[] {
  const contributions: ExtractedCouncilContribution[] = []
  const seen = new Set<string>()
  const addContribution = (contribution: ExtractedCouncilContribution) => {
    const key = `${normalized(contribution.family).toLowerCase()}|${normalized(contribution.content)}`
    if (!contribution.content || seen.has(key)) return
    seen.add(key)
    contributions.push(contribution)
  }

  ;(payload.results ?? []).forEach((row, index) => {
    if (!resultHasUsableProviderText(row, targetFamily)) return
    addContribution({
      contributionId: contributionKey({
        family: row.family,
        content: row.content,
        index,
        source: 'results.content',
      }),
      content: normalized(row.content),
      source: 'results.content',
      family: normalized(row.family) || targetFamily || null,
      displayFamily: normalized(row.family) || null,
    })
  })

  deliberationTurns(payload).forEach((turn, index) => {
    if (!turnHasUsableProviderText(turn, targetFamily)) return
    const content = normalized(turn.full_response)
    addContribution({
      contributionId: contributionKey({
        family: turn.provider_family ?? turn.provider_label,
        content,
        id: turn.output_message_id ?? turn.turn_id,
        index,
        source: 'familyDeliberation.turn',
      }),
      content,
      source: 'familyDeliberation.turn',
      family: normalized(turn.provider_family) || normalized(turn.provider_label) || targetFamily || null,
      displayFamily: normalized(turn.provider_label) || null,
    })
  })

  return contributions
}
