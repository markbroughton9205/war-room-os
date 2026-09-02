import type { CorpusSourceInventoryRow, ExampleFormat } from './types'

/** Static TypeScript/JavaScript is code, never automatically tool-use. */
export function hardenedCapabilityTags(row: Pick<CorpusSourceInventoryRow, 'path' | 'format' | 'capabilityTags'>): string[] {
  const tags = new Set(row.capabilityTags.filter(tag => tag !== 'tool-use' && tag !== 'tool_use'))
  if (row.format === 'code' || /\.(ts|tsx|mjs|cjs|js)$/.test(row.path)) tags.add('code')
  if (row.format === 'language_modeling') tags.add('language_modeling')
  if (row.format === 'structured_json') tags.add('structured_output')
  return [...tags].sort()
}

export function isStaticSourceCode(path: string, format: ExampleFormat): boolean {
  return format === 'code' || /\.(ts|tsx|mjs|cjs|js)$/.test(path)
}

export function domainForPath(path: string, format: ExampleFormat): string {
  if (format === 'structured_json' || path.endsWith('.json')) return 'json'
  if (isStaticSourceCode(path, format) || path.endsWith('.sql')) return 'code'
  if (path.includes('raw_intake') && (path.includes('alice') || path.includes('pride') || path.includes('frankenstein'))) return 'natural_language'
  if (path.endsWith('.md') || path.startsWith('docs/')) return 'natural_language'
  return format
}
