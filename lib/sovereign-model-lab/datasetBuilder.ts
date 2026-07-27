/**
 * Builds deterministic dataset manifests from admitted documents. Pure aggregation — no I/O
 * beyond what's already loaded by the caller (runtime.ts owns fetching the document list from
 * storage.ts; this module just computes the manifest from whatever it's handed, so it's
 * independently testable without touching the filesystem).
 */
import { createHash } from 'node:crypto'
import type { DatasetExclusionEntry, DatasetManifest, SovereignDocumentRecord } from './types'

/** Rough, honestly-labeled token estimate (chars/4) — not a real tokenizer count. Real counts
 * come from a verified TokenizerExperiment (see tokenizerVerifier.ts) once a tokenizer actually
 * exists and has passed verification. */
function estimateTokensForDocument(doc: SovereignDocumentRecord): number {
  return Math.ceil(doc.byteCount / 4)
}

export function buildDatasetManifest(documents: SovereignDocumentRecord[]): DatasetManifest {
  const admitted = documents.filter(d => d.allowedForTraining)
  const excluded: DatasetExclusionEntry[] = documents
    .filter(d => !d.allowedForTraining)
    .map(d => ({ documentId: d.id, reason: d.exclusionReason ?? 'No exclusion reason was recorded — treat as excluded pending investigation.', accessStatus: d.accessStatus }))

  const seenHashes = new Set<string>()
  let duplicateCount = 0
  const dedupedAdmitted: SovereignDocumentRecord[] = []
  for (const doc of admitted) {
    if (seenHashes.has(doc.contentHash)) {
      duplicateCount += 1
      continue
    }
    seenHashes.add(doc.contentHash)
    dedupedAdmitted.push(doc)
  }

  const languageDistribution: Record<string, number> = {}
  const sourceDistribution: Record<string, number> = {}
  const licenseDistribution: Record<string, number> = {}
  let estimatedTokens = 0

  for (const doc of dedupedAdmitted) {
    languageDistribution[doc.language] = (languageDistribution[doc.language] ?? 0) + 1
    sourceDistribution[doc.sourceType] = (sourceDistribution[doc.sourceType] ?? 0) + 1
    const licenseKey = doc.licenseStatus.licenseId ?? doc.accessStatus
    licenseDistribution[licenseKey] = (licenseDistribution[licenseKey] ?? 0) + 1
    estimatedTokens += estimateTokensForDocument(doc)
  }

  const documentIds = dedupedAdmitted.map(d => d.id).sort()
  const createdAt = new Date().toISOString()

  // Reproducible manifest ID: deterministic hash of the sorted document-id + hash set, not a
  // random UUID — the same admitted-document set always yields the same manifestId.
  const manifestId = createHash('sha256')
    .update(dedupedAdmitted.map(d => `${d.id}:${d.contentHash}`).sort().join('|'), 'utf8')
    .digest('hex')
    .slice(0, 32)

  const manifestWithoutChecksum: Omit<DatasetManifest, 'checksum'> = {
    manifestId,
    createdAt,
    documentIds,
    documentCount: dedupedAdmitted.length,
    estimatedTokens,
    languageDistribution,
    sourceDistribution,
    licenseDistribution,
    duplicateCount,
    excluded,
    commanderApproved: false,
    commanderApprovedAt: null,
  }

  const checksum = createHash('sha256').update(JSON.stringify(manifestWithoutChecksum), 'utf8').digest('hex')

  return { ...manifestWithoutChecksum, checksum }
}

export function approveDatasetManifest(manifest: DatasetManifest): DatasetManifest {
  return { ...manifest, commanderApproved: true, commanderApprovedAt: new Date().toISOString() }
}
