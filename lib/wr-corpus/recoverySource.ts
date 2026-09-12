/**
 * Read-only Mac recovery dump locator + dump verification.
 * Never mutates the dump. Never copies checkpoint trees.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_RECOVERY_DUMP_RELATIVE,
  FORBIDDEN_COPY_SEGMENTS,
} from './identity'
import { WrCorpusPolicyError, sha256File, readTextFile } from './hashes'

export const EXPECTED_DUMP_FILES = 2260
export const EXPECTED_DUMP_BYTES = 19560357065
export const EXPECTED_DUMP_STATUS = 'VERIFIED'

export const WRM001_EXPECTED_HASHES = {
  'corpus.jsonl': '12f7777cca1ef668f297cd09951ce3a0a151b4d50aae0b973f245a3301186d05',
  'manifest.json': '906aacfc2d61c53f301131d86237fd1c6522553b4cc7f5ad5ea9ad5d8d6d603e',
  'exclusions.json': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  'quality-report.json': '9519078fcd1ec0e4752a88b26de4e4bd4a5d994d03452eb9731038200dbf501d',
} as const

export const HARDENED_EXPECTED_SHARD_HASHES = {
  'train/shard-00000.jsonl': '0dd54a78fdb098d9b20a86e7698456ddfef9ee3a20bd424fde0ee1b03d14e068',
  'validation/shard-00000.jsonl': '1d57f8c7821132f3789812d9504300f4c8085f8ec6ea4eccd2ceddb4eab9b668',
  'test/shard-00000.jsonl': '655d51f040a8018b0d9790d7d83c69ae1159c19917183718470e59bb97249a90',
} as const

export const HARDENED_EXPECTED_COUNTS = {
  train: 8477,
  validation: 1853,
  test: 865,
  total: 11195,
  chunkCount: 11164,
} as const

export function defaultRecoveryDumpRoot(override?: string | null): string {
  if (override?.trim()) return path.resolve(override.trim())
  if (process.env.WAR_ROOM_RECOVERY_DUMP?.trim()) return path.resolve(process.env.WAR_ROOM_RECOVERY_DUMP.trim())
  return path.join(...DEFAULT_RECOVERY_DUMP_RELATIVE)
}

export function dumpIsReadOnly(dumpRoot: string): { ok: true } | { ok: false; reason: string } {
  const verification = path.join(dumpRoot, 'verification.json')
  if (!fs.existsSync(verification)) return { ok: false, reason: 'verification.json missing' }
  try {
    fs.accessSync(dumpRoot, fs.constants.R_OK)
  } catch {
    return { ok: false, reason: 'dump not readable' }
  }
  return { ok: true }
}

export async function readDumpVerification(dumpRoot: string): Promise<{
  status: string
  files: number
  bytes: number
  failures: unknown[]
  productionModified: boolean
  source: string
  destination: string
}> {
  const raw = await readTextFile(path.join(dumpRoot, 'verification.json'))
  return JSON.parse(raw) as {
    status: string
    files: number
    bytes: number
    failures: unknown[]
    productionModified: boolean
    source: string
    destination: string
  }
}

export function assertNotForbiddenCopyPath(relOrAbs: string): void {
  const normalized = relOrAbs.replace(/\\/g, '/').toLowerCase()
  for (const segment of FORBIDDEN_COPY_SEGMENTS) {
    if (normalized.includes(`/${segment.toLowerCase()}/`) || normalized.endsWith(`/${segment.toLowerCase()}`)) {
      throw new WrCorpusPolicyError(
        'CHECKPOINT_COPY_DENIED',
        `Refusing to copy historical checkpoint/tool tree segment: ${segment}`,
      )
    }
  }
}

export function countJsonlRecords(filePath: string): number {
  const text = fs.readFileSync(filePath, 'utf8')
  if (!text.trim()) return 0
  return text.split(/\r?\n/).filter(line => line.trim().length > 0).length
}

export async function verifyHardenedShard(dumpRoot: string, rel: keyof typeof HARDENED_EXPECTED_SHARD_HASHES): Promise<{
  hash: string
  records: number
}> {
  const full = path.join(dumpRoot, 'model-lab', 'corpora', 'WR-CORPUS-1-HARDENED', ...rel.split('/'))
  const hash = await sha256File(full)
  const expected = HARDENED_EXPECTED_SHARD_HASHES[rel]
  if (hash !== expected) {
    throw new WrCorpusPolicyError(
      'HASH_MISMATCH',
      `HARDENED ${rel} hash mismatch. expected ${expected} got ${hash}. STOP.`,
    )
  }
  return { hash, records: countJsonlRecords(full) }
}

export function wrm001VersionDir(dumpRoot: string): string {
  return path.join(
    dumpRoot,
    'sovereign-model-lab',
    'corpora',
    'WRM-001',
    '175af25fe1c17cf7630b506d0d6e6e88',
  )
}
