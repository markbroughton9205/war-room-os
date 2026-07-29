/**
 * Builds a real, immutable, versioned corpus artifact bundle (Part 5) from admitted documents
 * only. Distinct from datasetBuilder.ts's lightweight DatasetManifest accounting — this writes
 * the literal file bundle a tokenizer is actually trained from:
 *   .war-room/sovereign-model-lab/corpora/<corpusId>/<version>/
 *     corpus.jsonl / manifest.json / exclusions.json / quality-report.json / checksums.json
 *
 * No network access. No external provider access. Every included record's content hash is
 * verified against the live file bytes immediately before inclusion — a document whose bytes no
 * longer match its recorded contentHash is excluded, not silently trusted.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getLatestProvenanceEntry } from './provenanceLedger'
import { corpusVersionDir, corpusVersionExists } from './storage'
import type {
  CorpusBuildResult,
  CorpusClassification,
  CorpusExclusionEntry,
  CorpusManifest,
  CorpusQualityReport,
  SovereignDocumentRecord,
} from './types'

export class CorpusVersionExistsError extends Error {
  constructor(corpusId: string, version: string) {
    super(`Corpus version already exists and is immutable: ${corpusId}/${version}. Rebuild with different input to get a new version.`)
    this.name = 'CorpusVersionExistsError'
  }
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Deterministic version id: same admitted-document set (by id + content hash) always resolves to
 * the same version directory, mirroring datasetBuilder.ts's manifestId technique. */
function computeCorpusVersion(admitted: SovereignDocumentRecord[]): string {
  return sha256(admitted.map(d => `${d.id}:${d.contentHash}`).sort().join('|')).slice(0, 32)
}

/** Known-fixture detection is deliberately conservative — never guess "production_candidate";
 * that classification upgrade is a Commander judgment call, not a heuristic this module should
 * make on anyone's behalf. */
function classifyCorpus(admitted: SovereignDocumentRecord[]): CorpusClassification {
  const looksLikeFixture = admitted.some(d => (d.localPath ?? '').includes('__fixtures__') || d.metadata?.['fixtureOnly'] === true)
  if (looksLikeFixture || admitted.length === 0) return 'validation_only'
  // Even a real-looking small corpus stays validation_only until a Commander explicitly
  // reclassifies it — see honestyNote in the quality report.
  return 'validation_only'
}

async function atomicWrite(dir: string, fileName: string, content: string): Promise<void> {
  const target = path.join(dir, fileName)
  const tmp = path.join(dir, `.${fileName}.${randomUUID()}.tmp`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, target)
}

export async function buildCorpusArtifact(args: {
  corpusId: string
  sourceDatasetManifestId: string
  documents: SovereignDocumentRecord[]
}): Promise<CorpusBuildResult> {
  const admittedCandidates = args.documents.filter(d => d.allowedForTraining)

  // Hash verification before inclusion — re-read every candidate's live bytes and confirm they
  // still match the recorded contentHash. A mismatch excludes the document; it is never silently
  // trusted from stale metadata.
  const verified: { doc: SovereignDocumentRecord; text: string }[] = []
  const exclusions: CorpusExclusionEntry[] = args.documents
    .filter(d => !d.allowedForTraining)
    .map(d => ({ documentId: d.id, reason: d.exclusionReason ?? 'Not admitted for training.' }))

  for (const doc of admittedCandidates) {
    if (!doc.localPath) {
      exclusions.push({ documentId: doc.id, reason: 'No local file path recorded for this document.' })
      continue
    }
    let buffer: Buffer
    try {
      buffer = await readFile(doc.localPath)
    } catch (error) {
      exclusions.push({ documentId: doc.id, reason: `Could not re-read source file: ${error instanceof Error ? error.message : String(error)}` })
      continue
    }
    const liveHash = sha256(buffer)
    if (liveHash !== doc.contentHash) {
      exclusions.push({ documentId: doc.id, reason: `Content hash mismatch on re-read (recorded ${doc.contentHash.slice(0, 12)}…, live ${liveHash.slice(0, 12)}…) — file changed since ingestion.` })
      continue
    }
    const text = buffer.toString('utf8')
    if (!text.trim()) {
      exclusions.push({ documentId: doc.id, reason: 'Empty document content — no empty records are ever included in a corpus.' })
      continue
    }
    verified.push({ doc, text })
  }

  // Exact duplicate removal, deterministic ordering by documentId.
  const seenHashes = new Set<string>()
  let duplicateCount = 0
  const admitted: { doc: SovereignDocumentRecord; text: string }[] = []
  for (const entry of [...verified].sort((a, b) => a.doc.id.localeCompare(b.doc.id))) {
    if (seenHashes.has(entry.doc.contentHash)) {
      duplicateCount += 1
      exclusions.push({ documentId: entry.doc.id, reason: 'Exact duplicate of an already-included document (same content hash).' })
      continue
    }
    seenHashes.add(entry.doc.contentHash)
    admitted.push(entry)
  }

  const version = computeCorpusVersion(admitted.map(a => a.doc))
  const corpusDir = corpusVersionDir(args.corpusId, version)
  if (await corpusVersionExists(args.corpusId, version)) {
    throw new CorpusVersionExistsError(args.corpusId, version)
  }

  // Build JSONL lines deterministically ordered (already sorted by documentId above).
  const languageDistribution: Record<string, number> = {}
  let byteCount = 0
  let estimatedCharacterCount = 0
  const lines: string[] = []
  for (const { doc, text } of admitted) {
    const provenance = await getLatestProvenanceEntry(doc.id)
    languageDistribution[doc.language] = (languageDistribution[doc.language] ?? 0) + 1
    byteCount += doc.byteCount
    estimatedCharacterCount += text.length
    const record = {
      documentId: doc.id,
      sourceId: doc.sourceType,
      provenanceEntryId: provenance?.entryId ?? '',
      contentHash: doc.contentHash,
      language: doc.language,
      text,
    }
    lines.push(JSON.stringify(record))
  }
  const corpusJsonlContent = lines.join('\n') + (lines.length ? '\n' : '')
  const recordChecksum = sha256(corpusJsonlContent)

  const classification = classifyCorpus(admitted.map(a => a.doc))
  const estimatedTokenCount = Math.ceil(estimatedCharacterCount / 4)

  const manifestWithoutChecksum: Omit<CorpusManifest, 'manifestChecksum'> = {
    corpusId: args.corpusId,
    version,
    createdAt: new Date().toISOString(),
    classification,
    documentCount: admitted.length,
    excludedCount: exclusions.length,
    duplicateCount,
    byteCount,
    estimatedCharacterCount,
    estimatedTokenCount,
    recordChecksum,
    sourceDatasetManifestId: args.sourceDatasetManifestId,
  }
  const manifestChecksum = sha256(JSON.stringify(manifestWithoutChecksum))
  const manifest: CorpusManifest = { ...manifestWithoutChecksum, manifestChecksum }

  const qualityReport: CorpusQualityReport = {
    emptyRecordsRemoved: exclusions.filter(e => e.reason.startsWith('Empty document content')).length,
    exactDuplicatesRemoved: duplicateCount,
    languageDistribution,
  }

  await mkdir(corpusDir, { recursive: true })
  await atomicWrite(corpusDir, 'corpus.jsonl', corpusJsonlContent)
  await atomicWrite(corpusDir, 'manifest.json', JSON.stringify(manifest, null, 2))
  await atomicWrite(corpusDir, 'exclusions.json', JSON.stringify(exclusions, null, 2))
  await atomicWrite(corpusDir, 'quality-report.json', JSON.stringify(qualityReport, null, 2))

  const checksums = {
    'corpus.jsonl': recordChecksum,
    'manifest.json': sha256(JSON.stringify(manifest, null, 2)),
    'exclusions.json': sha256(JSON.stringify(exclusions, null, 2)),
    'quality-report.json': sha256(JSON.stringify(qualityReport, null, 2)),
  }
  await atomicWrite(corpusDir, 'checksums.json', JSON.stringify(checksums, null, 2))

  return {
    corpusDir,
    manifest,
    exclusions,
    qualityReport,
    files: {
      corpusJsonl: path.join(corpusDir, 'corpus.jsonl'),
      manifestJson: path.join(corpusDir, 'manifest.json'),
      exclusionsJson: path.join(corpusDir, 'exclusions.json'),
      qualityReportJson: path.join(corpusDir, 'quality-report.json'),
      checksumsJson: path.join(corpusDir, 'checksums.json'),
    },
  }
}

export async function readCorpusManifest(corpusId: string, version: string): Promise<CorpusManifest | null> {
  try {
    const raw = await readFile(path.join(corpusVersionDir(corpusId, version), 'manifest.json'), 'utf8')
    return JSON.parse(raw) as CorpusManifest
  } catch {
    return null
  }
}
