/**
 * Idempotent WR-CORPUS-0 / WR-CORPUS-1 migration from the read-only Mac recovery dump.
 * Copies only corpus lineage. Never copies WRIM/checkpoint/tool trees. Never mutates the dump.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WRIM_0_SHA256,
  HISTORICAL_WRIM_0_STATUS,
  HISTORICAL_WR_TOKENIZER_0_STATUS,
  SYSTEM_HISTORICAL_OWNER,
  WR_CORPUS_0_HISTORICAL_ID,
  WR_CORPUS_0_HISTORICAL_VERSION,
  WR_CORPUS_1_HISTORICAL_ID,
  WR_CORPUS_1_HISTORICAL_IDENTITY,
} from './identity'
import { WrCorpusPolicyError, sha256File, sha256FileOrThrow } from './hashes'
import { mapHistoricalRights, rightsForHardenedChunk } from './rights'
import {
  HARDENED_EXPECTED_COUNTS,
  WRM001_EXPECTED_HASHES,
  assertNotForbiddenCopyPath,
  countJsonlRecords,
  defaultRecoveryDumpRoot,
  dumpIsReadOnly,
  readDumpVerification,
  verifyHardenedShard,
  wrm001VersionDir,
} from './recoverySource'
import { WrCorpusStore, embedText, type CorpusRecordRow } from './store'

export type MigrationResult = {
  ok: true
  dumpRoot: string
  dumpVerification: Awaited<ReturnType<typeof readDumpVerification>>
  bytesCopied: number
  alreadyImported: boolean
  corpus0: { records: number; hash: string; bytes: number }
  corpus1: { records: number; hashes: Record<string, string>; bytes: number }
}

function copyFileTracked(src: string, dest: string): number {
  assertNotForbiddenCopyPath(src)
  assertNotForbiddenCopyPath(dest)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  try {
    fs.chmodSync(dest, 0o444)
  } catch {
    /* Windows may ignore file mode */
  }
  return fs.statSync(dest).size
}

function copyDirFiltered(src: string, dest: string, filter?: (rel: string) => boolean): number {
  let bytes = 0
  if (!fs.existsSync(src)) return 0
  const walk = (from: string, to: string, rel: string) => {
    fs.mkdirSync(to, { recursive: true })
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      const nextRel = rel ? `${rel}/${ent.name}` : ent.name
      if (filter && !filter(nextRel.replace(/\\/g, '/'))) continue
      const s = path.join(from, ent.name)
      const d = path.join(to, ent.name)
      assertNotForbiddenCopyPath(s)
      if (ent.isDirectory()) walk(s, d, nextRel)
      else bytes += copyFileTracked(s, d)
    }
  }
  walk(src, dest, '')
  return bytes
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

export async function migrateExistingWrCorpus(input: {
  dataDirOverride?: string | null
  dumpRoot?: string | null
  ownerUserId?: string
}): Promise<MigrationResult> {
  const dumpRoot = defaultRecoveryDumpRoot(input.dumpRoot)
  const readable = dumpIsReadOnly(dumpRoot)
  if (!readable.ok) throw new WrCorpusPolicyError('DUMP_UNREADABLE', readable.reason)
  const verification = await readDumpVerification(dumpRoot)
  if (verification.status !== 'VERIFIED' || (verification.failures ?? []).length > 0) {
    throw new WrCorpusPolicyError('DUMP_NOT_VERIFIED', 'Recovery dump verification is not VERIFIED.')
  }

  const store = new WrCorpusStore(input.dataDirOverride)
  try {
    const existing0 = store.getVersion('WR-CORPUS-0')
    const existing1 = store.getVersion('WR-CORPUS-1')
    if (existing0 && existing1 && existing0.content_hash === WRM001_EXPECTED_HASHES['corpus.jsonl']) {
      store.addMigrationEvent('idempotent_skip', { canonical: ['WR-CORPUS-0', 'WR-CORPUS-1'] })
      return {
        ok: true,
        dumpRoot,
        dumpVerification: verification,
        bytesCopied: 0,
        alreadyImported: true,
        corpus0: { records: existing0.record_count, hash: existing0.content_hash, bytes: existing0.bytes },
        corpus1: {
          records: existing1.record_count,
          hashes: (existing1.provenance.shard_hashes as Record<string, string>) ?? {},
          bytes: existing1.bytes,
        },
      }
    }

    const corpus0 = await migrateCorpus0(store, dumpRoot)
    const corpus1 = await migrateCorpus1(store, dumpRoot)
    store.addMigrationEvent('migrate_complete', {
      dumpRoot,
      dumpSource: verification.source,
      bytesCopied: corpus0.bytes + corpus1.bytes,
      windowsRoot: store.paths.root,
    })
    return {
      ok: true,
      dumpRoot,
      dumpVerification: verification,
      bytesCopied: corpus0.bytes + corpus1.bytes,
      alreadyImported: false,
      corpus0,
      corpus1,
    }
  } finally {
    store.close()
  }
}

async function migrateCorpus0(
  store: WrCorpusStore,
  dumpRoot: string,
): Promise<{ records: number; hash: string; bytes: number }> {
  const srcVersion = wrm001VersionDir(dumpRoot)
  const destVersion = path.join(store.paths.corpus0, 'historical', 'WRM-001', WR_CORPUS_0_HISTORICAL_VERSION)
  let bytes = 0
  for (const name of Object.keys(WRM001_EXPECTED_HASHES) as Array<keyof typeof WRM001_EXPECTED_HASHES>) {
    const src = path.join(srcVersion, name)
    const dest = path.join(destVersion, name)
    bytes += copyFileTracked(src, dest)
    await sha256FileOrThrow(dest, WRM001_EXPECTED_HASHES[name], `WR-CORPUS-0 ${name}`)
  }

  const sml = path.join(dumpRoot, 'sovereign-model-lab')
  for (const coll of ['documents', 'datasets', 'provenance', 'sources', 'programs', 'hardware']) {
    bytes += copyDirFiltered(path.join(sml, coll), path.join(store.paths.corpus0, 'lineage', coll))
  }
  bytes += copyDirFiltered(
    path.join(dumpRoot, 'model-lab', 'raw_intake'),
    path.join(store.paths.corpus0, 'raw_intake'),
  )

  const manifest = readJson<{
    corpusId: string
    version: string
    createdAt: string
    classification: string
    documentCount: number
    estimatedTokenCount: number
  }>(path.join(destVersion, 'manifest.json'))

  const jsonl = fs.readFileSync(path.join(destVersion, 'corpus.jsonl'), 'utf8')
  const lines = jsonl.split(/\r?\n/).filter(l => l.trim())
  if (lines.length !== 6) {
    throw new WrCorpusPolicyError('RECORD_COUNT', `WR-CORPUS-0 expected 6 records, got ${lines.length}`)
  }

  const docsDir = path.join(store.paths.corpus0, 'lineage', 'documents')
  const now = new Date().toISOString()
  for (const line of lines) {
    const rec = JSON.parse(line) as {
      documentId: string
      sourceId: string
      provenanceEntryId: string
      contentHash: string
      language: string
      text: string
    }
    const docPath = path.join(docsDir, `${rec.documentId}.json`)
    const doc = fs.existsSync(docPath)
      ? readJson<{
          title?: string
          localPath?: string
          licenseStatus?: {
            licenseId?: string | null
            licenseName?: string | null
            permitsTrainingUse?: boolean
          }
          accessStatus?: string
        }>(docPath)
      : {}
    const rights = mapHistoricalRights({
      licenseId: doc.licenseStatus?.licenseId,
      licenseName: doc.licenseStatus?.licenseName,
      permitsTrainingUse: doc.licenseStatus?.permitsTrainingUse,
      accessStatus: doc.accessStatus,
    })
    const row: CorpusRecordRow = {
      record_id: `wr0:${rec.documentId}`,
      corpus_version: 'WR-CORPUS-0',
      owner_user_id: SYSTEM_HISTORICAL_OWNER,
      title: doc.title ?? rec.documentId,
      text: rec.text,
      source_type: rec.sourceId,
      split: 'genesis',
      content_hash: rec.contentHash,
      rights,
      training_eligibility: rights.training_eligibility,
      review_state: 'HISTORICAL_IMMUTABLE',
      provenance: {
        historical_name: WR_CORPUS_0_HISTORICAL_ID,
        historical_version: WR_CORPUS_0_HISTORICAL_VERSION,
        historical_mac_path: `/Users/markbroughton/Developer/war-room-os/.war-room/sovereign-model-lab/corpora/WRM-001/${WR_CORPUS_0_HISTORICAL_VERSION}/corpus.jsonl`,
        canonical_windows_path: destVersion,
        recovery_dump: dumpRoot,
        provenanceEntryId: rec.provenanceEntryId,
        localPath: doc.localPath ?? null,
      },
      historical_path: doc.localPath ?? null,
      canonical_path: destVersion,
      created_at: manifest.createdAt,
      active: true,
      tombstone_policy: null,
      source_candidate_id: null,
    }
    store.insertRecord(row, embedText(`${row.title}\n${row.text}`))
  }

  store.upsertVersion({
    canonical_id: 'WR-CORPUS-0',
    historical_id: WR_CORPUS_0_HISTORICAL_ID,
    historical_version: WR_CORPUS_0_HISTORICAL_VERSION,
    physical_layout: 'wrm001_bundle',
    artifact_relpath: path.relative(store.paths.root, destVersion),
    content_hash: WRM001_EXPECTED_HASHES['corpus.jsonl'],
    record_count: 6,
    created_at: manifest.createdAt,
    migrated_at: now,
    classification: {
      canonical_name: 'WR-CORPUS-0',
      historical_name: 'WRM-001',
      real_data: true,
      genesis_smoke: true,
      validation_only: true,
      original_classification: manifest.classification,
      estimatedTokenCount: manifest.estimatedTokenCount,
    },
    rights_summary: { public_domain: 3, commander_owned: 3 },
    training_eligibility: 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT',
    historical_model_lineage: {
      tokenizer: { id: 'WR-TOKENIZER-0', sha256: HISTORICAL_WR_TOKENIZER_0_SHA256, status: HISTORICAL_WR_TOKENIZER_0_STATUS },
      wrim0: { id: 'WRIM-0', sha256: HISTORICAL_WRIM_0_SHA256, status: HISTORICAL_WRIM_0_STATUS },
      wrim1: { run000001: 'COLLAPSED_PROMOTION_REJECTED', run000002: 'FAILED_NOT_PROMOTED' },
    },
    immutable: true,
    provenance: {
      recovery_dump: dumpRoot,
      dump_source: '/Users/markbroughton/Developer/war-room-os',
      windows_canonical: destVersion,
    },
    source_types: ['gutenberg_public_domain', 'commander_owned_repo_sample'],
    quality_status: 'quality-report present; 0 empty; 0 duplicates',
    active: true,
    bytes,
  })
  return { records: 6, hash: WRM001_EXPECTED_HASHES['corpus.jsonl'], bytes }
}

async function migrateCorpus1(
  store: WrCorpusStore,
  dumpRoot: string,
): Promise<{ records: number; hashes: Record<string, string>; bytes: number }> {
  const src = path.join(dumpRoot, 'model-lab', 'corpora', 'WR-CORPUS-1-HARDENED')
  const dest = path.join(store.paths.corpus1, 'historical', 'WR-CORPUS-1-HARDENED')
  const bytesHardened = copyDirFiltered(src, dest)
  const bytesWave8 = copyDirFiltered(
    path.join(dumpRoot, 'model-lab', 'manifests', 'wave8'),
    path.join(store.paths.corpus1, 'lineage', 'wave8'),
  )
  const bytesWave81 = copyDirFiltered(
    path.join(dumpRoot, 'model-lab', 'manifests', 'wave8_1'),
    path.join(store.paths.corpus1, 'lineage', 'wave8_1'),
    rel => !rel.replace(/\\/g, '/').endsWith('corpus-manifest.json'),
  )
  const bytes = bytesHardened + bytesWave8 + bytesWave81

  const hashes: Record<string, string> = {}
  const counts: Record<string, number> = {}
  for (const rel of Object.keys(HARDENED_EXPECTED_COUNTS).filter(k => k === 'train' || k === 'validation' || k === 'test') as Array<
    'train' | 'validation' | 'test'
  >) {
    const shardRel = `${rel}/shard-00000.jsonl` as const
    const verified = await verifyHardenedShard(dumpRoot, shardRel)
    const destShard = path.join(dest, ...shardRel.split('/'))
    const destHash = await sha256File(destShard)
    if (destHash !== verified.hash) {
      throw new WrCorpusPolicyError('HASH_MISMATCH', `Copied HARDENED ${shardRel} hash drifted.`)
    }
    hashes[shardRel] = destHash
    counts[rel] = countJsonlRecords(destShard)
    if (counts[rel] !== HARDENED_EXPECTED_COUNTS[rel]) {
      throw new WrCorpusPolicyError(
        'RECORD_COUNT',
        `HARDENED ${rel} expected ${HARDENED_EXPECTED_COUNTS[rel]} got ${counts[rel]}`,
      )
    }
  }

  const total = (counts.train ?? 0) + (counts.validation ?? 0) + (counts.test ?? 0)
  if (total !== HARDENED_EXPECTED_COUNTS.total) {
    throw new WrCorpusPolicyError('RECORD_COUNT', `HARDENED total expected 11195 got ${total}`)
  }

  const now = new Date().toISOString()
  store.begin()
  try {
    for (const split of ['train', 'validation', 'test'] as const) {
    const shard = path.join(dest, split, 'shard-00000.jsonl')
    const fh = fs.readFileSync(shard, 'utf8').split(/\r?\n/).filter(l => l.trim())
    for (const line of fh) {
      const rec = JSON.parse(line) as {
        chunk_id: string
        split: string
        source_path: string
        contentHash: string
        text: string
        format?: string
        shard_id?: string
      }
      const rights = rightsForHardenedChunk(rec.source_path)
      const row: CorpusRecordRow = {
        record_id: `wr1:${rec.chunk_id}`,
        corpus_version: 'WR-CORPUS-1',
        owner_user_id: SYSTEM_HISTORICAL_OWNER,
        title: rec.source_path,
        text: rec.text,
        source_type: rec.format ?? 'chunk',
        split: rec.split,
        content_hash: rec.contentHash,
        rights,
        training_eligibility: rights.training_eligibility,
        review_state: 'HISTORICAL_IMMUTABLE',
        provenance: {
          historical_name: WR_CORPUS_1_HISTORICAL_ID,
          historical_identity: WR_CORPUS_1_HISTORICAL_IDENTITY,
          historical_mac_path: `/Users/markbroughton/Developer/war-room-os/model-lab/corpora/WR-CORPUS-1-HARDENED/${rec.shard_id ?? ''}`,
          canonical_windows_path: dest,
          recovery_dump: dumpRoot,
          source_path: rec.source_path,
        },
        historical_path: rec.source_path,
        canonical_path: dest,
        created_at: '2026-08-30T23:13:14+00:00',
        active: true,
        tombstone_policy: null,
        source_candidate_id: null,
      }
      store.insertRecord(row, embedText(`${row.title}\n${row.text.slice(0, 4000)}`))
    }
    }
    store.commit()
  } catch (error) {
    store.rollback()
    throw error
  }

  const identityHash = createHash('sha256')
    .update(JSON.stringify({ hashes, total }))
    .digest('hex')

  store.upsertVersion({
    canonical_id: 'WR-CORPUS-1',
    historical_id: WR_CORPUS_1_HISTORICAL_ID,
    historical_version: WR_CORPUS_1_HISTORICAL_IDENTITY,
    physical_layout: 'hardened_shards',
    artifact_relpath: path.relative(store.paths.root, dest),
    content_hash: identityHash,
    record_count: total,
    created_at: '2026-08-30T23:13:14+00:00',
    migrated_at: now,
    classification: {
      canonical_name: 'WR-CORPUS-1',
      historical_source_identity: WR_CORPUS_1_HISTORICAL_ID,
      real_data: true,
      hardened_candidate: true,
      historical_status: 'PRODUCTION_CANDIDATE',
      not_current_production_model_corpus: true,
      not_automatically_training_eligible: true,
      promoted: false,
      chunkCount: HARDENED_EXPECTED_COUNTS.chunkCount,
    },
    rights_summary: { mapped_from_source_path: true },
    training_eligibility: 'HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT',
    historical_model_lineage: {
      tokenizer: { id: 'WR-TOKENIZER-0', sha256: HISTORICAL_WR_TOKENIZER_0_SHA256, status: HISTORICAL_WR_TOKENIZER_0_STATUS },
      wrim0: { id: 'WRIM-0', sha256: HISTORICAL_WRIM_0_SHA256, status: HISTORICAL_WRIM_0_STATUS },
      wrim1_run_000001: 'REAL_TRAINING_COLLAPSED_PROMOTION_REJECTED',
      wrim1_run_000002: 'REAL_PARTIAL_TRAINING_FAILED_NOT_PROMOTED',
      recovery_experiments: 'TEST_ONLY',
    },
    immutable: true,
    provenance: {
      recovery_dump: dumpRoot,
      dump_source: '/Users/markbroughton/Developer/war-room-os',
      windows_canonical: dest,
      shard_hashes: hashes,
      wave8_manifest: path.join(store.paths.corpus1, 'lineage', 'wave8', 'corpus-manifest.json'),
    },
    source_types: ['commander_owned_repo', 'inherited_wr_corpus_0_literature'],
    quality_status: 'wave8/8.1 hardened candidate; not promoted',
    active: true,
    bytes,
  })
  return { records: total, hashes, bytes }
}

export function denyDuplicateImport(store: WrCorpusStore, canonicalId: string): void {
  if (store.getVersion(canonicalId)) {
    throw new WrCorpusPolicyError('DUPLICATE_VERSION', `${canonicalId} already imported.`)
  }
}
