/**
 * Tokenizer verification (Part 10) — all 18 mandatory checks. Only after every one of these
 * passes may a program enter tokenizer_ready. Checks 1-7 and 16-18 run directly in Node (file
 * existence, hashing, manifest/corpus linkage, vocab sanity, special-token parsing straight out of
 * tokenizer.json, URL/model-hub grep, path containment). Checks 8-15 (encode/decode/round-trip/
 * unicode/unknown-chars/empty/long-input/fresh-process-reload) delegate to
 * scripts/sovereign-model-lab/verify_wrm001_tokenizer.py, a brand-new bounded subprocess — being a
 * new process is itself the "fresh process reload" proof.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { REQUIRED_TOKENIZER_SPECIAL_TOKENS } from './types'
import type { TokenizerArtifactFile, TokenizerVerificationCheck, TokenizerVerificationResult } from './types'

const execFileAsync = promisify(execFile)
const VERIFY_SCRIPT_TIMEOUT_MS = 30_000
const MODEL_HUB_MARKERS = ['huggingface.co', 'hf.co', 'modelscope.cn', 'civitai.com', 'models--', 'http://', 'https://']

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function check(id: string, label: string, passed: boolean, detail: string): TokenizerVerificationCheck {
  return { id, label, passed, detail }
}

function tokenizerVaultRoot(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'sovereign-model-lab', 'tokenizers', 'WRM-001')
}

function isContainedUnderVault(candidate: string): boolean {
  const root = path.resolve(tokenizerVaultRoot())
  const abs = path.resolve(candidate)
  const rel = path.relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export async function verifyTokenizerArtifact(args: {
  artifactDir: string
  tokenizerJsonPath: string
  trainingManifestPath: string
  corpusJsonlPath: string
  /** The corpus manifest's recordChecksum — a real SHA-256 of the exact corpus.jsonl bytes at
   * corpus-build time (see corpusBuilder.ts). Rechecked fresh here against the corpus.jsonl bytes
   * actually on disk right now, not trusted from memory. */
  expectedCorpusRecordChecksum: string
  verifyScriptPythonExecutable: string
}): Promise<TokenizerVerificationResult> {
  const checks: TokenizerVerificationCheck[] = []

  // 18. Output path containment — checked first; if this fails, refuse to even read the files.
  const contained = [args.artifactDir, args.tokenizerJsonPath, args.trainingManifestPath].every(isContainedUnderVault)
  checks.push(check('output_path_contained', 'Output path is contained under the WRM-001 tokenizer vault', contained, contained ? tokenizerVaultRoot() : `One or more paths escape ${tokenizerVaultRoot()}`))
  if (!contained) {
    return { verifiedAt: new Date().toISOString(), allMandatoryChecksPassed: false, checks }
  }

  // 1. Expected files exist.
  let tokenizerJsonBuffer: Buffer | null = null
  let trainingManifestRaw: string | null = null
  try {
    tokenizerJsonBuffer = await readFile(args.tokenizerJsonPath)
    checks.push(check('files_exist_tokenizer', 'tokenizer.json exists', true, `${tokenizerJsonBuffer.length} bytes`))
  } catch (error) {
    checks.push(check('files_exist_tokenizer', 'tokenizer.json exists', false, error instanceof Error ? error.message : String(error)))
  }
  try {
    trainingManifestRaw = await readFile(args.trainingManifestPath, 'utf8')
    checks.push(check('files_exist_manifest', 'Training manifest exists', true, `${trainingManifestRaw.length} bytes`))
  } catch (error) {
    checks.push(check('files_exist_manifest', 'Training manifest exists', false, error instanceof Error ? error.message : String(error)))
  }

  if (!tokenizerJsonBuffer || !trainingManifestRaw) {
    return { verifiedAt: new Date().toISOString(), allMandatoryChecksPassed: false, checks }
  }

  // 2. Every artifact has a SHA-256 hash (computed here, real, not carried over from a stale record).
  const artifactFiles: TokenizerArtifactFile[] = [
    { fileName: 'tokenizer.json', byteCount: tokenizerJsonBuffer.length, sha256: sha256(tokenizerJsonBuffer) },
    { fileName: path.basename(args.trainingManifestPath), byteCount: Buffer.byteLength(trainingManifestRaw, 'utf8'), sha256: sha256(Buffer.from(trainingManifestRaw, 'utf8')) },
  ]
  checks.push(check('artifacts_hashed', 'Every artifact has a SHA-256 hash', artifactFiles.every(f => /^[0-9a-f]{64}$/.test(f.sha256)), artifactFiles.map(f => `${f.fileName}:${f.sha256.slice(0, 12)}…`).join(', ')))

  let trainingManifest: Record<string, unknown> | null = null
  try {
    trainingManifest = JSON.parse(trainingManifestRaw) as Record<string, unknown>
  } catch {
    trainingManifest = null
  }

  // 3. Manifest references the correct corpus.
  const manifestCorpusPath = typeof trainingManifest?.corpusPath === 'string' ? trainingManifest.corpusPath : null
  const corpusPathMatches = manifestCorpusPath !== null && path.resolve(manifestCorpusPath) === path.resolve(args.corpusJsonlPath)
  checks.push(check('manifest_references_corpus', 'Manifest references the correct corpus', corpusPathMatches, `manifest corpusPath=${manifestCorpusPath ?? 'missing'}`))

  // 4. Corpus hash matches (recomputed fresh from the corpus.jsonl bytes actually on disk right
  // now — never trusted from an in-memory record).
  try {
    const corpusBytes = await readFile(args.corpusJsonlPath)
    const liveCorpusHash = sha256(corpusBytes)
    const matches = liveCorpusHash === args.expectedCorpusRecordChecksum
    checks.push(check('corpus_hash_matches', 'Corpus hash matches the manifest recorded at build time', matches, `live=${liveCorpusHash.slice(0, 12)}… expected=${args.expectedCorpusRecordChecksum.slice(0, 12)}…`))
  } catch (error) {
    checks.push(check('corpus_hash_matches', 'Corpus hash matches the manifest recorded at build time', false, error instanceof Error ? error.message : String(error)))
  }

  // 5. Vocabulary size is real.
  const vocabSizeProduced = typeof trainingManifest?.vocabSizeProduced === 'number' ? trainingManifest.vocabSizeProduced : null
  checks.push(check('vocab_size_real', 'Vocabulary size is real', typeof vocabSizeProduced === 'number' && vocabSizeProduced > 0, `vocabSizeProduced=${vocabSizeProduced ?? 'missing'}`))

  // 6/7. Special tokens exist + unique IDs — parsed directly out of tokenizer.json's vocab, no
  // Python round-trip needed for this part.
  let vocab: Record<string, number> = {}
  try {
    const parsedTokenizerJson = JSON.parse(tokenizerJsonBuffer.toString('utf8')) as { model?: { vocab?: Record<string, number> } }
    vocab = parsedTokenizerJson.model?.vocab ?? {}
  } catch {
    vocab = {}
  }
  const specialTokenIds = REQUIRED_TOKENIZER_SPECIAL_TOKENS.map(token => vocab[token])
  const allSpecialTokensPresent = specialTokenIds.every(id => typeof id === 'number')
  checks.push(check('special_tokens_exist', 'Special tokens exist', allSpecialTokensPresent, REQUIRED_TOKENIZER_SPECIAL_TOKENS.map((t, i) => `${t}=${specialTokenIds[i] ?? 'missing'}`).join(', ')))
  const presentIds = specialTokenIds.filter((id): id is number => typeof id === 'number')
  checks.push(check('special_token_ids_unique', 'Special token IDs are unique', presentIds.length === new Set(presentIds).size, `${presentIds.length} present, ${new Set(presentIds).size} unique`))

  // 16/17. No external artifact/URL/model-hub references anywhere in the manifest text.
  const manifestLower = trainingManifestRaw.toLowerCase()
  const foundMarkers = MODEL_HUB_MARKERS.filter(marker => manifestLower.includes(marker))
  checks.push(check('no_external_references', 'No external artifact/URL/model-hub references in manifest', foundMarkers.length === 0, foundMarkers.length ? `found: ${foundMarkers.join(', ')}` : 'clean'))

  // 8-15. Delegate to the bounded Python verification subprocess — a brand-new process, which is
  // itself the "fresh process reload" check. Invokes the exact persisted executable path directly
  // — never a bare command name, never a shell. Fails closed if no exact path was ever resolved.
  if (!args.verifyScriptPythonExecutable || !path.isAbsolute(args.verifyScriptPythonExecutable)) {
    checks.push(check('python_verification_subprocess', 'Python verification subprocess ran successfully', false, 'No exact (absolute) Python executable path was provided — refusing to invoke a bare command name or fall back to shell resolution.'))
  } else {
    try {
      const { stdout } = await execFileAsync(
        args.verifyScriptPythonExecutable,
        [path.join(resolveRepoRoot(), 'scripts', 'sovereign-model-lab', 'verify_wrm001_tokenizer.py'), '--tokenizer-path', args.tokenizerJsonPath],
        { windowsHide: true, timeout: VERIFY_SCRIPT_TIMEOUT_MS, shell: false },
      )
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { ok: boolean; checks: TokenizerVerificationCheck[] }
      checks.push(...parsed.checks)
    } catch (error) {
      checks.push(check('python_verification_subprocess', 'Python verification subprocess ran successfully', false, error instanceof Error ? error.message : String(error)))
    }
  }

  const allMandatoryChecksPassed = checks.every(c => c.passed)
  return { verifiedAt: new Date().toISOString(), allMandatoryChecksPassed, checks }
}

export function summarizeArtifactFiles(tokenizerJsonBuffer: Buffer, trainingManifestBuffer: Buffer, trainingManifestFileName: string): TokenizerArtifactFile[] {
  return [
    { fileName: 'tokenizer.json', byteCount: tokenizerJsonBuffer.length, sha256: sha256(tokenizerJsonBuffer) },
    { fileName: trainingManifestFileName, byteCount: trainingManifestBuffer.length, sha256: sha256(trainingManifestBuffer) },
  ]
}
