const MAX_EXCERPTS = 8
const MAX_EXCERPT_CHARS = 800
const MAX_TOTAL_CHARS = 20_000

const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/json', 'text/csv'])

export type DocumentScanExcerpt = {
  sectionLabel: string
  text: string
  relevanceScore: number
}

export type DocumentScanStatus = 'complete' | 'unsupported_format' | 'empty'

export type DocumentScanResult = {
  status: DocumentScanStatus
  message: string
  excerpts: DocumentScanExcerpt[]
}

export function isExtractableTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType)
}

export function extractRelevantSections(input: {
  mimeType: string
  fileName: string
  buffer: Buffer
  objective: string
}): DocumentScanResult {
  if (!isExtractableTextMimeType(input.mimeType)) {
    return {
      status: 'unsupported_format',
      message: `PDF and other binary formats are not yet supported for extraction in this environment (mime type: ${input.mimeType || 'unknown'}). Text, Markdown, JSON, and CSV documents are supported.`,
      excerpts: [],
    }
  }

  const text = input.buffer.toString('utf8').slice(0, MAX_TOTAL_CHARS)
  if (!text.trim()) {
    return { status: 'empty', message: 'The document contains no extractable text.', excerpts: [] }
  }

  const sections = splitIntoSections(text)
  const objectiveTerms = significantTerms(input.objective)
  const scored = sections.map((section, index) => ({
    sectionLabel: `${input.fileName} — excerpt ${index + 1} of ${sections.length}`,
    text: section.slice(0, MAX_EXCERPT_CHARS),
    relevanceScore: scoreRelevance(section, objectiveTerms),
  }))

  const ranked = objectiveTerms.length
    ? [...scored].sort((a, b) => b.relevanceScore - a.relevanceScore)
    : scored

  const excerpts = ranked.slice(0, MAX_EXCERPTS)

  return {
    status: 'complete',
    message: objectiveTerms.length
      ? `Found ${excerpts.length} relevant excerpt(s) for the current objective.`
      : `No objective provided — returning the first ${excerpts.length} excerpt(s) of the document.`,
    excerpts,
  }
}

function splitIntoSections(text: string): string[] {
  const raw = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  return raw.length ? raw : [text.trim()]
}

function significantTerms(objective: string): string[] {
  return objective
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 3)
}

function scoreRelevance(section: string, terms: string[]): number {
  if (!terms.length) return 0
  const lower = section.toLowerCase()
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0)
}
