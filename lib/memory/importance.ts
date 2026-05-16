import type { ArchiveTranscriptInput } from '@/lib/memory/transcriptArchive'

export const MEMORY_IMPORTANCE_TIERS = ['trivial', 'operational', 'strategic', 'critical'] as const

export type MemoryImportanceTier = (typeof MEMORY_IMPORTANCE_TIERS)[number]

export type MemoryImportanceClassification = {
  tier: MemoryImportanceTier
  score: number
  decayWeight: number
  tags: string[]
  reasons: string[]
  preserve: boolean
}

type ClassifyInput = ArchiveTranscriptInput & {
  compressedCount?: number
}

const CRITICAL_PATTERNS = [
  /\bmission\s*critical\b/i,
  /\bsecurity\b.*\b(fix|patch|incident|breach|risk)\b/i,
  /\bapproval safeguard\b/i,
  /\bdata loss\b|\bcorruption\b/i,
  /\bproduction\b.*\b(down|blocked|incident|recovered|fixed)\b/i,
]

const STRATEGIC_PATTERNS = [
  /\barchitecture\b|\barchitectural\b/i,
  /\broot cause\b|\broot-cause\b/i,
  /\bapproved patch\b|\bpatch report\b|\bfix report\b/i,
  /\bimplemented\b|\bshipped\b|\bdeployed\b|\bcommitted\b|\bpushed\b/i,
  /\bsystem evolution\b|\bevolved\b|\bphase\s+\d/i,
  /\bstrategic conclusion\b|\bstrategy\b/i,
  /\broadmap\b|\bprotocol\b|\bgovernance\b/i,
  /\bprovider routing\b|\bpacket lifecycle\b|\battendance\b/i,
  /\bfamily specialization\b|\bfamily debate\b/i,
]

const OPERATIONAL_PATTERNS = [
  /\bresolved\b|\bfixed\b|\brestored\b|\bvalidated\b/i,
  /\beconomic\b|\bincome\b|\brevenue\b|\bopportunity\b|\bscout\b/i,
  /\bworkflow\b|\bapproval\b|\btelemetry\b|\bpersistence\b/i,
  /\bdecision\b|\bdecided\b|\bnext action\b/i,
  /\btest(ed|ing)?\b.*\bpassed\b|\bvalidation passed\b/i,
]

const TRIVIAL_PATTERNS = [
  /^\s*(test|testing|ping|hello|ok|okay|retry|again)\s*$/i,
  /\brepeated test\b|\btest message\b/i,
  /\battendance check\b|\broll call\b/i,
  /\btelemetry\b.*\b(spam|noise|heartbeat)\b/i,
  /\bprovider unavailable\b|\bnot responded yet\b/i,
  /\bmemory archive recall failed\b|\bfailed recall\b/i,
]

const PROTECTED_PATTERNS = [
  /\broot cause\b|\broot-cause\b/i,
  /\bsuccessful patch\b|\bapproved patch\b|\bpatch report\b/i,
  /\bsystem evolution\b|\barchitecture\b|\barchitectural\b/i,
  /\bstrategic conclusion\b|\bapproved architecture\b/i,
  /\bimplemented\b.*\bphase\b|\bcommitted\b.*\bpushed\b/i,
]

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

function pushMatches(tags: string[], reasons: string[], text: string, label: string, patterns: RegExp[], amount: number): number {
  let score = 0
  for (const pattern of patterns) {
    if (!pattern.test(text)) continue
    score += amount
    if (!tags.includes(label)) tags.push(label)
    reasons.push(label)
    break
  }
  return score
}

function normalizeCommand(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function memoryCompressionKey(message: ArchiveTranscriptInput): string {
  const family = (message.family ?? message.role).toLowerCase().trim()
  const kind = message.messageType.toLowerCase().trim()
  return `${family}|${kind}|${normalizeCommand(message.content)}`
}

export function classifyMemoryImportance(input: ClassifyInput): MemoryImportanceClassification {
  const text = `${input.family ?? ''} ${input.messageType} ${input.tags.join(' ')} ${input.topic ?? ''} ${input.content}`
  const tags = new Set(input.tags.filter(Boolean))
  const reasons: string[] = []
  let score = 0.35

  const protectedMemory = PROTECTED_PATTERNS.some(pattern => pattern.test(text))
  if (protectedMemory) {
    tags.add('protected_memory')
    reasons.push('protected_memory')
    score += 0.35
  }

  score += pushMatches([...tags], reasons, text, 'critical_signal', CRITICAL_PATTERNS, 0.45)
  if (reasons.includes('critical_signal')) tags.add('critical_signal')

  score += pushMatches([...tags], reasons, text, 'strategic_signal', STRATEGIC_PATTERNS, 0.3)
  if (reasons.includes('strategic_signal')) tags.add('strategic_signal')

  score += pushMatches([...tags], reasons, text, 'operational_signal', OPERATIONAL_PATTERNS, 0.18)
  if (reasons.includes('operational_signal')) tags.add('operational_signal')

  const compressedCount = input.compressedCount ?? 1
  if (compressedCount > 1) {
    tags.add('duplicate_compressed')
    reasons.push('duplicate_compressed')
    score += input.messageType === 'decree' ? 0.1 : 0.02
  }

  const trivialSignal = TRIVIAL_PATTERNS.some(pattern => pattern.test(text))
  if (trivialSignal && !protectedMemory && compressedCount <= 1) {
    tags.add('trivial_noise')
    reasons.push('trivial_noise')
    score -= 0.35
  }

  const wordCount = input.content.trim().split(/\s+/).filter(Boolean).length
  if (wordCount < 4 && !protectedMemory && compressedCount <= 1) {
    tags.add('low_context')
    reasons.push('low_context')
    score -= 0.2
  }

  if (input.messageType === 'decree' && score < 0.45 && compressedCount <= 1) {
    score += 0.08
    tags.add('operator_decree')
  }

  const finalScore = clampScore(score)
  let tier: MemoryImportanceTier = 'trivial'
  if (finalScore >= 0.85) tier = 'critical'
  else if (finalScore >= 0.65) tier = 'strategic'
  else if (finalScore >= 0.4) tier = 'operational'

  if (protectedMemory && tier === 'trivial') tier = 'strategic'
  if (compressedCount > 1 && input.messageType === 'decree' && tier === 'trivial') tier = 'operational'

  return {
    tier,
    score: finalScore,
    decayWeight: tier === 'critical' ? 1 : tier === 'strategic' ? 0.85 : tier === 'operational' ? 0.55 : 0.15,
    tags: [...tags],
    reasons,
    preserve: tier !== 'trivial',
  }
}
