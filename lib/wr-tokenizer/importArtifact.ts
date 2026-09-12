/**
 * Copy ONLY tokenizer.json + training-manifest.json into AppData.
 * Never copies WRIM checkpoints. Never mutates the recovery dump.
 */
import fs from 'node:fs'
import path from 'node:path'
import { sha256File, WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import { tightenFileMode } from '@/lib/sovereign-runtime/local-ownership/paths'
import {
  HISTORICAL_WR_TOKENIZER_0_SHA256,
  HISTORICAL_WR_TOKENIZER_ID,
} from './identity'
import { dumpTokenizerManifestPath, dumpTokenizerPath, rehashDumpTokenizer } from './inspect'
import { ensureWrTokenizerDirs, resolveWrTokenizerPaths, type WrTokenizerPaths } from './paths'

export type WrTokenizerImportResult = {
  ok: true
  alreadyImported: boolean
  sha256: string
  sourcePath: string
  canonicalPath: string
  importedAt: string
  verificationStatus: 'HASH_VERIFIED'
  bytesCopied: number
}

export async function importWrTokenizer0(opts?: {
  dataDirOverride?: string | null
  dumpRoot?: string | null
}): Promise<WrTokenizerImportResult> {
  const hashed = await rehashDumpTokenizer(opts?.dumpRoot)
  const paths = resolveWrTokenizerPaths(opts?.dataDirOverride)
  ensureWrTokenizerDirs(paths)
  assertTokenizerOnlyCopy(paths)

  if (fs.existsSync(paths.tokenizerJson)) {
    const existing = await sha256File(paths.tokenizerJson)
    if (existing !== HISTORICAL_WR_TOKENIZER_0_SHA256) {
      throw new WrCorpusPolicyError(
        'HASH_MISMATCH',
        `Active WR-TOKENIZER-0 copy hash mismatch. expected ${HISTORICAL_WR_TOKENIZER_0_SHA256} got ${existing}. STOP.`,
      )
    }
    return {
      ok: true,
      alreadyImported: true,
      sha256: existing,
      sourcePath: hashed.path,
      canonicalPath: paths.tokenizerJson,
      importedAt: readImportTimestamp(paths) ?? new Date().toISOString(),
      verificationStatus: 'HASH_VERIFIED',
      bytesCopied: 0,
    }
  }

  const manifestSrc = dumpTokenizerManifestPath(opts?.dumpRoot)
  fs.copyFileSync(hashed.path, paths.tokenizerJson)
  if (fs.existsSync(manifestSrc)) fs.copyFileSync(manifestSrc, paths.trainingManifest)
  tightenFileMode(paths.tokenizerJson)
  try {
    fs.chmodSync(paths.tokenizerJson, 0o444)
  } catch {
    /* Windows may ignore */
  }

  const copyHash = await sha256File(paths.tokenizerJson)
  if (copyHash !== HISTORICAL_WR_TOKENIZER_0_SHA256) {
    throw new WrCorpusPolicyError(
      'HASH_MISMATCH',
      `Copied WR-TOKENIZER-0 hash mismatch. expected ${HISTORICAL_WR_TOKENIZER_0_SHA256} got ${copyHash}. STOP.`,
    )
  }

  const importedAt = new Date().toISOString()
  const importManifest = {
    id: HISTORICAL_WR_TOKENIZER_ID,
    sha256: copyHash,
    historicalSourcePath: hashed.path,
    canonicalLocalPath: paths.tokenizerJson,
    importedAt,
    verificationStatus: 'HASH_VERIFIED',
    recoveryDumpUntouched: true,
    checkpointsCopied: false,
  }
  fs.writeFileSync(paths.importManifest, `${JSON.stringify(importManifest, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    alreadyImported: false,
    sha256: copyHash,
    sourcePath: hashed.path,
    canonicalPath: paths.tokenizerJson,
    importedAt,
    verificationStatus: 'HASH_VERIFIED',
    bytesCopied: fs.statSync(paths.tokenizerJson).size + (fs.existsSync(paths.trainingManifest) ? fs.statSync(paths.trainingManifest).size : 0),
  }
}

function readImportTimestamp(paths: WrTokenizerPaths): string | null {
  if (!fs.existsSync(paths.importManifest)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(paths.importManifest, 'utf8')) as { importedAt?: string }
    return raw.importedAt ?? null
  } catch {
    return null
  }
}

function assertTokenizerOnlyCopy(paths: WrTokenizerPaths): void {
  if (!fs.existsSync(paths.root)) return
  const stack = [paths.root]
  while (stack.length) {
    const cur = stack.pop()!
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name)
      const norm = full.replace(/\\/g, '/').toLowerCase()
      if (norm.includes('/wrim0_checkpoints/') || norm.includes('/wrim1_checkpoints/') || ent.name.endsWith('.safetensors')) {
        throw new WrCorpusPolicyError('CHECKPOINT_COPY_DENIED', 'WRIM checkpoints must not live under wr-tokenizer.')
      }
      if (ent.isDirectory()) stack.push(full)
    }
  }
}
