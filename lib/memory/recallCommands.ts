export const RECALL_COMMANDS = [
  'recall today',
  'recall last session',
  'recall grok',
  'recall economic ops',
  'recall income ideas',
  'show archive',
  'summarize today',
  'summarize last session',
] as const

export type RecallCommandKind = (typeof RECALL_COMMANDS)[number]
export type RecallScope = 'today' | 'last_session' | 'recent'
export type RecallTopic = 'grok' | 'economic_ops' | 'income_ideas' | null

export type ParsedRecallCommand = {
  kind: RecallCommandKind
  scope: RecallScope
  topic: RecallTopic
  summarize: boolean
}

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function parseRecallCommand(input: string): ParsedRecallCommand | null {
  const t = normalize(input)
  switch (t) {
    case 'recall today':
      return { kind: 'recall today', scope: 'today', topic: null, summarize: false }
    case 'recall last session':
      return { kind: 'recall last session', scope: 'last_session', topic: null, summarize: false }
    case 'recall grok':
      return { kind: 'recall grok', scope: 'recent', topic: 'grok', summarize: false }
    case 'recall economic ops':
      return { kind: 'recall economic ops', scope: 'recent', topic: 'economic_ops', summarize: false }
    case 'recall income ideas':
      return { kind: 'recall income ideas', scope: 'recent', topic: 'income_ideas', summarize: false }
    case 'show archive':
      return { kind: 'show archive', scope: 'recent', topic: null, summarize: false }
    case 'summarize today':
      return { kind: 'summarize today', scope: 'today', topic: null, summarize: true }
    case 'summarize last session':
      return { kind: 'summarize last session', scope: 'last_session', topic: null, summarize: true }
    default:
      return null
  }
}

export type RecallTranscriptPreview = {
  id: string
  timestamp: string
  role: string
  family: string | null
  provider: string | null
  messageType: string | null
  content: string
  tags: string[]
  topic: string | null
}

export type RecallSummaryPreview = {
  id: string
  createdAt: string
  summaryKind: string
  summary: string
}

export function formatRecallResponse(input: {
  command: ParsedRecallCommand
  records: RecallTranscriptPreview[]
  summaries: RecallSummaryPreview[]
  persistenceAvailable: boolean
}): string {
  const { command, records, summaries, persistenceAvailable } = input
  if (!persistenceAvailable) {
    return 'Memory archive is unavailable because Supabase persistence is not configured.'
  }

  if (command.summarize) {
    if (summaries.length) {
      return [
        `Archive summary for ${command.kind}:`,
        ...summaries.slice(0, 3).map(summary => `- ${summary.summary}`),
      ].join('\n')
    }
    if (!records.length) return `No archived transcript found for ${command.kind}.`
    return [
      `Archive summary for ${command.kind}:`,
      ...records.slice(0, 8).map(record => `- ${record.family ?? record.role}: ${record.content}`),
    ].join('\n')
  }

  if (!records.length) return `No archived transcript found for ${command.kind}.`

  return [
    `Archive recall for ${command.kind} (${records.length} result${records.length === 1 ? '' : 's'}):`,
    ...records.slice(0, 12).map(record => {
      const family = record.family ?? record.role
      const topic = record.topic ? ` · ${record.topic}` : ''
      return `- ${new Date(record.timestamp).toLocaleString()} · ${family}${topic}: ${record.content}`
    }),
  ].join('\n')
}
