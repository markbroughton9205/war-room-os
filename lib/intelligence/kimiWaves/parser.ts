import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import {
  KIMI_WAVE_FILE_MANIFEST,
  KIMI_WAVE_REPORTS_ROOT,
  type KimiWaveFileManifest,
} from '@/lib/intelligence/kimiWaves/manifest'

export type KimiWaveChunk = {
  id: string
  wave: 1 | 2
  sequence: number
  sourceFile: string
  relativePath: string
  section: string
  text: string
  urls: string[]
  registryRefs: string[]
  domain: string
  artifactAt: string
  origin_type: 'KIMI_WAVE'
}

export type KimiWaveParseResult = {
  ok: boolean
  filesDiscovered: number
  recordsParsed: number
  chunks: KimiWaveChunk[]
  error?: string
}

const URL_RE = /https?:\/\/[^\s)\]>'"]+/gi
const REGISTRY_REF_RE = /\bWARROOM_[A-Z0-9_]+\b/g
const HEADING_RE = /^(#{1,3})\s+(.+)$/
const NUMBERED_SOURCE_RE = /^(?:\*\*)?\d{1,3}[.)]\s+\*?\*?(.+?)(?:\*\*)?$/
const MIN_CHUNK_CHARS = 80
const MAX_CHUNK_CHARS = 1800

function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map(url => url.replace(/[.,;:]+$/, '')))].slice(0, 12)
}

function extractRegistryRefs(text: string): string[] {
  return [...new Set(text.match(REGISTRY_REF_RE) ?? [])].slice(0, 12)
}

function flushChunk(
  chunks: KimiWaveChunk[],
  file: KimiWaveFileManifest,
  section: string,
  body: string,
  index: { n: number },
): void {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length < MIN_CHUNK_CHARS) return
  const pieces = text.length <= MAX_CHUNK_CHARS
    ? [text]
    : splitLong(text, MAX_CHUNK_CHARS)
  for (const piece of pieces) {
    index.n += 1
    chunks.push({
      id: `kimi-w${file.wave}-${file.sequence}-${index.n}`,
      wave: file.wave,
      sequence: file.sequence,
      sourceFile: file.filename,
      relativePath: `${KIMI_WAVE_REPORTS_ROOT}/${file.relativePath}`,
      section: section.slice(0, 220) || file.domain,
      text: piece,
      urls: extractUrls(piece),
      registryRefs: extractRegistryRefs(piece),
      domain: file.domain,
      artifactAt: file.artifactAt,
      origin_type: 'KIMI_WAVE',
    })
  }
}

function splitLong(text: string, max: number): string[] {
  const out: string[] = []
  let remaining = text
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('. ', max)
    if (cut < max * 0.5) cut = max
    out.push(remaining.slice(0, cut + 1).trim())
    remaining = remaining.slice(cut + 1).trim()
  }
  if (remaining.length >= MIN_CHUNK_CHARS) out.push(remaining)
  return out
}

export function parseKimiWaveMarkdown(file: KimiWaveFileManifest, markdown: string): KimiWaveChunk[] {
  const chunks: KimiWaveChunk[] = []
  const index = { n: 0 }
  let section = file.domain
  let buffer: string[] = []

  const flush = () => {
    flushChunk(chunks, file, section, buffer.join('\n'), index)
    buffer = []
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const heading = HEADING_RE.exec(line.trim())
    if (heading) {
      flush()
      section = heading[2]!.trim()
      continue
    }
    const numbered = NUMBERED_SOURCE_RE.exec(line.trim())
    if (numbered && buffer.join('\n').trim().length >= MIN_CHUNK_CHARS) {
      flush()
      section = numbered[1]!.trim().slice(0, 220)
    }
    buffer.push(line)
  }
  flush()
  return chunks
}

export function parseAllKimiWaveReports(rootDir?: string): KimiWaveParseResult {
  try {
    const root = rootDir ?? path.join(resolveBaseRepoRoot(), KIMI_WAVE_REPORTS_ROOT)
    const chunks: KimiWaveChunk[] = []
    let filesDiscovered = 0
    for (const file of KIMI_WAVE_FILE_MANIFEST) {
      const abs = path.join(root, file.relativePath)
      const markdown = readFileSync(abs, 'utf8')
      filesDiscovered += 1
      chunks.push(...parseKimiWaveMarkdown(file, markdown))
    }
    return {
      ok: true,
      filesDiscovered,
      recordsParsed: chunks.length,
      chunks,
    }
  } catch (error) {
    return {
      ok: false,
      filesDiscovered: 0,
      recordsParsed: 0,
      chunks: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
