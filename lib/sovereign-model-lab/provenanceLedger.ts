/**
 * Append-only local provenance ledger under .war-room/sovereign-model-lab/provenance/. Changing a
 * document after ingestion creates a NEW versioned ledger entry rather than overwriting the prior
 * one — every past state remains readable. This module is a leaf: it never imports runtime.ts.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveSovereignModelLabStorageRoot } from './storage'
import type { DatasetAccessStatus, DatasetLicenseRecord } from './types'

export type ProvenanceLedgerEntry = {
  entryId: string
  documentId: string
  version: number
  at: string
  sourceIdentity: { sourceType: string; sourceUrl?: string; localPath?: string; publisher: string }
  retrievalMethod: string
  rightsStatus: { accessStatus: DatasetAccessStatus; license: DatasetLicenseRecord }
  contentHash: string
  transformHistory: string[]
  dedupHistory: string[]
  datasetMembership: string[]
  commanderDecisions: { at: string; decision: string; note?: string }[]
  supersedesEntryId: string | null
}

function ledgerDirFor(documentId: string): string {
  return path.join(resolveSovereignModelLabStorageRoot(), 'provenance', documentId)
}

async function atomicWriteJson(dir: string, fileName: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, fileName)
  const tmp = path.join(dir, `.${fileName}.${randomUUID()}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, target)
}

/** All versions for a document, oldest first (file names are zero-padded version numbers, so a
 * plain lexical sort is a correct chronological sort). */
export async function listProvenanceVersions(documentId: string): Promise<ProvenanceLedgerEntry[]> {
  const dir = ledgerDirFor(documentId)
  let names: string[]
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out: ProvenanceLedgerEntry[] = []
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      out.push(JSON.parse(raw) as ProvenanceLedgerEntry)
    } catch {
      /* skip corrupt entry */
    }
  }
  return out
}

export async function getLatestProvenanceEntry(documentId: string): Promise<ProvenanceLedgerEntry | null> {
  const versions = await listProvenanceVersions(documentId)
  return versions.at(-1) ?? null
}

/**
 * Appends a new version. Never overwrites — always writes a new file. If a prior version exists,
 * the new entry records `supersedesEntryId` so the full history stays traceable.
 */
export async function appendProvenanceEntry(
  documentId: string,
  entry: Omit<ProvenanceLedgerEntry, 'entryId' | 'version' | 'at' | 'supersedesEntryId'>,
): Promise<ProvenanceLedgerEntry> {
  const existing = await listProvenanceVersions(documentId)
  const previous = existing.at(-1) ?? null
  const nextVersion = (previous?.version ?? 0) + 1

  const full: ProvenanceLedgerEntry = {
    ...entry,
    entryId: randomUUID(),
    documentId,
    version: nextVersion,
    at: new Date().toISOString(),
    supersedesEntryId: previous?.entryId ?? null,
  }

  const fileName = `${String(nextVersion).padStart(6, '0')}.json`
  await atomicWriteJson(ledgerDirFor(documentId), fileName, full)
  return full
}

export async function listAllProvenanceDocumentIds(): Promise<string[]> {
  const root = path.join(resolveSovereignModelLabStorageRoot(), 'provenance')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}
