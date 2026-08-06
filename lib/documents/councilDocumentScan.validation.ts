import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractRelevantSections, isExtractableTextMimeType } from './councilDocumentScan'

type ValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string): ValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function routeHasCommanderFirst(src: string, handler: string): boolean {
  const index = src.indexOf(`export async function ${handler}`)
  if (index < 0) return false
  const body = src.slice(index, index + 400)
  const commander = body.indexOf('requireCommanderSession')
  const json = body.indexOf('req.json')
  return commander >= 0 && (json < 0 || commander < json)
}

export function runCouncilDocumentScanValidation(): ValidationResult[] {
  const routeSource = source('app/api/council/documents/scan/route.ts')

  const largeObjective = 'relocation strategy planning objective'
  const longText = Buffer.from(`Intro paragraph about unrelated topics.\n\n${'relocation planning content. '.repeat(50)}\n\nFinal paragraph unrelated.`, 'utf8')
  const boundedResult = extractRelevantSections({
    mimeType: 'text/plain',
    fileName: 'test.txt',
    buffer: longText,
    objective: largeObjective,
  })

  const pdfResult = extractRelevantSections({
    mimeType: 'application/pdf',
    fileName: 'book.pdf',
    buffer: Buffer.from('%PDF-1.4 fake binary content', 'utf8'),
    objective: 'anything',
  })

  const emptyResult = extractRelevantSections({
    mimeType: 'text/plain',
    fileName: 'empty.txt',
    buffer: Buffer.from('   \n\n  ', 'utf8'),
    objective: '',
  })

  return [
    test('docscan_01_route_requires_commander_session', () => routeHasCommanderFirst(routeSource, 'POST') || 'POST /api/council/documents/scan does not gate on requireCommanderSession before reading the request body'),
    test('docscan_02_route_not_in_public_exemption_list', () => {
      const middleware = source('lib/supabase/middleware.ts')
      return !middleware.includes("'/api/council/documents/scan'") || 'route must not be listed in PUBLIC_API_PATHS'
    }),
    test('docscan_03_pdf_reports_unsupported_truthfully', () => pdfResult.status === 'unsupported_format' && pdfResult.excerpts.length === 0 || 'PDF input must report unsupported_format with zero fabricated excerpts'),
    test('docscan_04_pdf_message_does_not_claim_extraction', () => !pdfResult.message.toLowerCase().includes('extracted') || 'unsupported-format message must not claim content was extracted'),
    test('docscan_05_empty_document_reports_empty', () => emptyResult.status === 'empty' && emptyResult.excerpts.length === 0 || 'whitespace-only document must report empty status with no excerpts'),
    test('docscan_06_extraction_is_bounded', () => boundedResult.excerpts.length <= 8 || 'excerpt count must stay bounded (<= 8)'),
    test('docscan_07_excerpt_text_is_bounded', () => boundedResult.excerpts.every(excerpt => excerpt.text.length <= 800) || 'each excerpt must stay under the character cap'),
    test('docscan_08_relevant_excerpts_ranked_first', () => {
      if (!boundedResult.excerpts.length) return 'expected at least one excerpt'
      return boundedResult.excerpts[0].relevanceScore >= (boundedResult.excerpts.at(-1)?.relevanceScore ?? 0) || 'excerpts must be ranked by relevance score descending'
    }),
    test('docscan_09_section_labels_use_excerpt_numbers_not_fake_pages', () => boundedResult.excerpts.every(excerpt => /excerpt \d+ of \d+/.test(excerpt.sectionLabel)) || 'section labels must use defensible excerpt numbering, not fabricated page numbers'),
    test('docscan_10_route_source_has_no_content_logging', () => {
      const scanCallIndex = routeSource.indexOf('extractRelevantSections(')
      const logIndex = routeSource.indexOf('console.info(')
      if (scanCallIndex < 0 || logIndex < 0) return 'expected both an extraction call and a console.info metadata log in the route'
      const logBlock = routeSource.slice(logIndex, logIndex + 260)
      const leaksRawExcerpts = /excerpts:\s*result\.excerpts(?!\.length)/.test(logBlock) || logBlock.includes('buffer')
      return !leaksRawExcerpts || 'log call must not include raw excerpt/file content, only metadata'
    }),
    test('docscan_11_route_does_not_write_memory_tables', () => {
      const memoryTokens = ['approved_memory', 'memory_core', 'mission_continuity', 'family_memory']
      return !memoryTokens.some(token => routeSource.toLowerCase().includes(token)) || 'route must not write to any Memory Core / approved-memory table'
    }),
    test('docscan_12_isExtractableTextMimeType_matches_extraction_behavior', () => {
      const textOk = isExtractableTextMimeType('text/plain') && isExtractableTextMimeType('text/markdown') && isExtractableTextMimeType('application/json') && isExtractableTextMimeType('text/csv')
      const pdfBlocked = !isExtractableTextMimeType('application/pdf')
      return (textOk && pdfBlocked) || 'text/markdown/json/csv must be extractable and pdf must not be'
    }),
  ]
}
