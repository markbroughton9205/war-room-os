/**
 * Canonical transcript is a structured TranscriptDocument, never a free-floating blob.
 * Persists beside VI observations: analysis/{projectId}/{assetId}/transcript.json
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { analysisDir } from './video-intelligence'
import { stripSecrets } from './secrets'
import { fromSeconds, toSeconds, type MediaTime } from './time'

export const TRANSCRIPT_SCHEMA = 1 as const

export type TranscriptWord = {
  start: MediaTime
  end: MediaTime
  text: string
  confidence?: number
}

export type TranscriptSegment = {
  start: MediaTime
  end: MediaTime
  text: string
  confidence?: number
  words?: TranscriptWord[]
}

export type TranscriptDocument = {
  schemaVersion: typeof TRANSCRIPT_SCHEMA
  assetId: string
  projectId: string
  language: string | null
  backend: string
  model: string | null
  createdAt: string
  duration: MediaTime
  segments: TranscriptSegment[]
  cacheKey?: string
}

export type TranscriptSearchHit = {
  text: string
  timestamp: MediaTime
  end: MediaTime
  confidence: number | null
  evidence: string
  source: 'transcript'
}

export function transcriptPath(projectId: string, assetId: string): string {
  return path.join(analysisDir(projectId, assetId), 'transcript.json')
}

export function emptyTranscript(projectId: string, assetId: string): TranscriptDocument {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA,
    assetId,
    projectId,
    language: null,
    backend: 'none',
    model: null,
    createdAt: new Date().toISOString(),
    duration: fromSeconds(0),
    segments: [],
  }
}

export function validateTranscriptDocument(doc: TranscriptDocument): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (doc.schemaVersion !== TRANSCRIPT_SCHEMA) errors.push('Unknown transcript schema.')
  if (!doc.assetId || !doc.projectId) errors.push('Transcript missing assetId/projectId.')
  if (!Array.isArray(doc.segments)) errors.push('segments must be an array.')
  if (typeof doc.backend !== 'string' || !doc.backend) errors.push('backend required.')
  for (const seg of doc.segments ?? []) {
    if (!seg.start || !seg.end) errors.push('Segment missing start/end.')
    if (typeof seg.text !== 'string') errors.push('Segment text must be a string.')
    if (seg.confidence != null && (seg.confidence < 0 || seg.confidence > 1)) errors.push('Segment confidence must be 0..1.')
    for (const word of seg.words ?? []) {
      if (typeof word.text !== 'string') errors.push('Word text must be a string.')
      if (!word.start || !word.end) errors.push('Word missing start/end.')
    }
  }
  return { ok: errors.length === 0, errors }
}

export function writeTranscript(doc: TranscriptDocument): string {
  const clean = stripSecrets(doc)
  const check = validateTranscriptDocument(clean)
  if (!check.ok) throw new Error(check.errors.join('; '))
  const file = transcriptPath(doc.projectId, doc.assetId)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return file
}

export function readTranscriptSync(projectId: string, assetId: string): TranscriptDocument | null {
  const file = transcriptPath(projectId, assetId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as TranscriptDocument
  } catch {
    return null
  }
}

export async function readTranscript(projectId: string, assetId: string): Promise<TranscriptDocument | null> {
  return readTranscriptSync(projectId, assetId)
}

function normalizeSpeech(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function wordRangeHit(words: TranscriptWord[], needle: string): TranscriptSearchHit | null {
  if (!words.length) return null
  const needleToks = normalizeSpeech(needle).split(' ').filter(Boolean)
  if (!needleToks.length) return null
  const toks = words.map(word => normalizeSpeech(word.text))
  for (let i = 0; i <= toks.length - needleToks.length; i++) {
    const window = toks.slice(i, i + needleToks.length)
    if (needleToks.every((tok, j) => window[j].includes(tok) || tok.includes(window[j]))) {
      const endWord = words[i + needleToks.length - 1] ?? words[i]
      return {
        text: words.slice(i, i + needleToks.length).map(word => word.text).join(' '),
        timestamp: words[i].start,
        end: endWord.end,
        confidence: words[i].confidence ?? null,
        evidence: `word-level ${toSeconds(words[i].start).toFixed(3)}s`,
        source: 'transcript',
      }
    }
  }
  const joined = toks.join(' ')
  if (!joined.includes(normalizeSpeech(needle))) return null
  return {
    text: words.map(word => word.text).join(' '),
    timestamp: words[0].start,
    end: words[words.length - 1]?.end ?? words[0].end,
    confidence: words[0].confidence ?? null,
    evidence: 'word-level',
    source: 'transcript',
  }
}

export function searchTranscript(doc: TranscriptDocument, query: string): TranscriptSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const hits: TranscriptSearchHit[] = []
  for (const seg of doc.segments) {
    const words = seg.words ?? []
    const wordHit = wordRangeHit(words, needle)
    if (wordHit) {
      hits.push(wordHit)
      continue
    }
    const hay = (seg.text ?? '').toLowerCase()
    if (hay.includes(needle)) {
      hits.push({
        text: seg.text,
        timestamp: seg.start,
        end: seg.end,
        confidence: seg.confidence ?? null,
        evidence: `segment ${toSeconds(seg.start).toFixed(3)}s–${toSeconds(seg.end).toFixed(3)}s`,
        source: 'transcript',
      })
    }
  }
  return hits
}

export type CaptionProposal = {
  start: MediaTime
  end: MediaTime
  text: string
  source: 'transcript'
}

export function proposeCaptionsFromTranscript(doc: TranscriptDocument): CaptionProposal[] {
  return doc.segments
    .filter(s => s.text.trim().length > 0)
    .map(s => ({ start: s.start, end: s.end, text: s.text.trim(), source: 'transcript' as const }))
}

export function deleteTranscript(projectId: string, assetId: string): boolean {
  const file = transcriptPath(projectId, assetId)
  if (!existsSync(file)) return false
  unlinkSync(file)
  return true
}
