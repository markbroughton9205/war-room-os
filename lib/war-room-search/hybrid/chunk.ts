import { createHash } from 'node:crypto'
import type { CrawlDocumentRecord } from '../crawler/types'
import {
  CHUNK_OVERLAP_CHARS,
  CHUNKING_VERSION,
  MAX_CHUNK_CHARS,
  TARGET_CHUNK_CHARS,
  type DocumentChunk,
} from './types'

export function chunkIdFor(input: {
  documentId: number
  contentHash: string
  chunkingVersion: string
  ordinal: number
  charStart: number
  charEnd: number
}): string {
  const material = [
    input.documentId,
    input.contentHash,
    input.chunkingVersion,
    input.ordinal,
    input.charStart,
    input.charEnd,
  ].join('|')
  return `chk_${createHash('sha256').update(material).digest('hex').slice(0, 24)}`
}

function nextBoundary(text: string, from: number, min: number, max: number): number {
  if (max >= text.length) return text.length
  const window = text.slice(min, Math.min(max, text.length))
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph >= 40) return min + paragraph + 2
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
  if (sentence >= 40) return min + sentence + 2
  const space = window.lastIndexOf(' ')
  if (space >= 40) return min + space + 1
  return Math.min(max, text.length)
}

export function chunkText(text: string): Array<{ ordinal: number; charStart: number; charEnd: number; text: string }> {
  const source = text.replace(/\r\n/g, '\n')
  if (!source.trim()) {
    return [{ ordinal: 0, charStart: 0, charEnd: source.length, text: source }]
  }
  if (source.length <= MAX_CHUNK_CHARS) {
    return [{ ordinal: 0, charStart: 0, charEnd: source.length, text: source }]
  }

  const spans: Array<{ charStart: number; charEnd: number; text: string }> = []
  let start = 0
  while (start < source.length) {
    const hardEnd = Math.min(start + MAX_CHUNK_CHARS, source.length)
    const softEnd = Math.min(start + TARGET_CHUNK_CHARS, source.length)
    const end = nextBoundary(source, start, Math.max(start + 1, softEnd), hardEnd)
    spans.push({ charStart: start, charEnd: end, text: source.slice(start, end) })
    if (end >= source.length) break
    const next = end - CHUNK_OVERLAP_CHARS
    start = next <= start ? end : next
  }
  return spans.map((span, ordinal) => ({ ordinal, ...span }))
}

export function chunkDocument(document: CrawlDocumentRecord, chunkingVersion = CHUNKING_VERSION): DocumentChunk[] {
  const body = document.contentText?.trim()
    ? document.contentText
    : [document.title, document.description].filter(Boolean).join('\n\n')
  return chunkText(body).map(span => ({
    chunkId: chunkIdFor({
      documentId: document.id,
      contentHash: document.contentHash,
      chunkingVersion,
      ordinal: span.ordinal,
      charStart: span.charStart,
      charEnd: span.charEnd,
    }),
    documentId: document.id,
    canonicalUrl: document.canonicalUrl,
    publisher: document.publisher,
    contentHash: document.contentHash,
    chunkOrdinal: span.ordinal,
    charStart: span.charStart,
    charEnd: span.charEnd,
    text: span.text,
    chunkingVersion,
  }))
}
