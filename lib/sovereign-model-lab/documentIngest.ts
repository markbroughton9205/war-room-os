/**
 * Local-only document ingestion. Reuses lib/repo/paths.ts's resolveRepoRoot() for containment
 * (server-configured, never client-overridable — same discipline as
 * lib/native-builder/repositoryInspector.ts). No network retrieval happens in this module at all.
 * Ingested files are only ever read as text/binary buffers and hashed — never executed, never
 * treated as macros, never extracted as archives (out of scope for this phase by design).
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'

export const MAX_INGEST_FILE_BYTES = 25 * 1024 * 1024 // 25MB

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.json', '.jsonl', '.csv', '.html'])
/** PDF is named as an allowed format in the spec, gated on "an existing safe parser if already
 * available" — none exists in this repo's dependencies today, so PDF ingestion is honestly
 * unsupported in Phase 1 rather than adding a new unreviewed parsing dependency. */
const KNOWN_BUT_UNSUPPORTED_EXTENSIONS = new Set(['.pdf'])

export class IngestDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IngestDeniedError'
  }
}

function resolveContainedPath(relOrAbsPath: string): string {
  const root = path.resolve(resolveRepoRoot())
  const trimmed = relOrAbsPath.trim()
  if (!trimmed) throw new IngestDeniedError('Empty path.')
  const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new IngestDeniedError(`Path escapes the configured repository root: ${relOrAbsPath}`)
  }
  const segments = rel.split(path.sep)
  if (segments.some(seg => seg === 'node_modules' || seg === '.git' || seg === '.war-room')) {
    throw new IngestDeniedError(`Path targets a denylisted directory: ${relOrAbsPath}`)
  }
  return abs
}

/** Extremely small heuristic language guess — real signal, honestly narrow, never claims false
 * confidence. Defaults to 'unknown' rather than guessing when no stopword set matches clearly. */
function guessLanguage(sampleText: string): string {
  const lower = sampleText.slice(0, 5000).toLowerCase()
  const wordCount = (pattern: RegExp) => (lower.match(pattern) ?? []).length
  const scores: Record<string, number> = {
    en: wordCount(/\b(the|and|of|to|in|is|that|for|with)\b/g),
    es: wordCount(/\b(el|la|de|que|y|en|los|para|con)\b/g),
    fr: wordCount(/\b(le|la|de|et|les|des|pour|avec|est)\b/g),
    de: wordCount(/\b(der|die|das|und|von|mit|für|ist|nicht)\b/g),
  }
  const [best, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return bestScore >= 5 ? best : 'unknown'
}

function detectEncoding(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8-bom'
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be'
  // Cheap UTF-8 validity check: decode then re-encode and compare byte length class.
  try {
    const text = buffer.toString('utf8')
    const reencoded = Buffer.byteLength(text, 'utf8')
    if (Math.abs(reencoded - buffer.length) <= Math.ceil(buffer.length * 0.02)) return 'utf-8'
  } catch {
    /* fall through */
  }
  return 'unknown'
}

export type LocalIngestCandidate = {
  ok: boolean
  localPath?: string
  contentHash?: string
  byteCount?: number
  encoding?: string
  languageGuess?: string
  contentType?: string
  rawTextSample?: string
  error?: string
}

/** Reads and hashes one local file. Never executes it, never extracts it, never follows it as a
 * macro/script regardless of extension. */
export async function ingestLocalFile(relOrAbsPath: string): Promise<LocalIngestCandidate> {
  let abs: string
  try {
    abs = resolveContainedPath(relOrAbsPath)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const ext = path.extname(abs).toLowerCase()
  if (KNOWN_BUT_UNSUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${ext}" ingestion requires a safe parser that is not installed in this repository — unsupported in Phase 1.` }
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `File extension "${ext || '(none)'}" is not in the allowed ingest set (${[...ALLOWED_EXTENSIONS].join(', ')}).` }
  }

  let info
  try {
    info = await stat(abs)
  } catch (error) {
    return { ok: false, error: `Cannot stat file: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!info.isFile()) return { ok: false, error: 'Not a regular file.' }
  if (info.size > MAX_INGEST_FILE_BYTES) {
    return { ok: false, error: `File exceeds the ${MAX_INGEST_FILE_BYTES} byte ingest limit (${info.size} bytes).` }
  }

  const buffer = await readFile(abs)
  const contentHash = createHash('sha256').update(buffer).digest('hex')
  const encoding = detectEncoding(buffer)
  const text = encoding.startsWith('utf-8') || encoding === 'unknown' ? buffer.toString('utf8') : buffer.toString('utf8')
  const languageGuess = guessLanguage(text)

  const contentTypeByExt: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.jsonl': 'application/jsonl',
    '.csv': 'text/csv',
    '.html': 'text/html',
  }

  return {
    ok: true,
    localPath: path.relative(resolveRepoRoot(), abs).split(path.sep).join('/'),
    contentHash,
    byteCount: info.size,
    encoding,
    languageGuess,
    contentType: contentTypeByExt[ext] ?? 'application/octet-stream',
    rawTextSample: text.slice(0, 500),
  }
}

/** Exact-duplicate check against a caller-supplied set of known hashes (storage.ts owns the real
 * document index — this stays a pure function so it's independently testable). */
export function isExactDuplicate(contentHash: string, knownHashes: ReadonlySet<string>): boolean {
  return knownHashes.has(contentHash)
}

/**
 * Near-duplicate placeholder interface (Part 5's explicit requirement — "support a placeholder
 * interface", not a real similarity algorithm this phase). Always returns not-near-duplicate
 * with an honest "not implemented" reason rather than a fabricated similarity score.
 */
export type NearDuplicateCheckResult = {
  isNearDuplicate: false
  similarityScore: null
  reason: 'near_duplicate_detection_not_implemented_in_phase_1'
}

export function checkNearDuplicate(contentHash: string, knownDocuments: readonly { contentHash: string }[]): NearDuplicateCheckResult {
  // Interface accepts real arguments (matching the eventual real implementation's signature) but
  // Phase 1 intentionally never computes a similarity score from them — see the module doc above.
  void contentHash
  void knownDocuments
  return { isNearDuplicate: false, similarityScore: null, reason: 'near_duplicate_detection_not_implemented_in_phase_1' }
}
