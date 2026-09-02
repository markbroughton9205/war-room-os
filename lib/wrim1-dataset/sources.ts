import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import type { CorpusSourceInventoryRow, ExampleFormat, SourceClass } from './types'
import { estimateUtf8Tokens, normalizeForDedup, sha256 } from './hash'

const SKIP_DIR = new Set([
  'node_modules', '.git', '.next', 'dist', 'coverage', '_to_delete_phaseb_patch', '_to_delete_phased_patch',
  '_to_delete_phasee_patch', '_to_delete_phasef_patch', '_to_delete_phaseg_patch', '_to_delete_phaseg_terra_patch',
  '_to_delete_phaseh_patch', '_to_delete_phasei_patch', '_to_delete_phasek_patch', '_to_delete_phasel_patch',
  '.war-room',
])

const INELIGIBLE_SUFFIX = ['.safetensors', '.npy', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.map']
const INELIGIBLE_NAME = new Set(['.env', '.env.local', '.env.production', '.DS_Store'])

const WR_CORPUS_0_INTAKE = [
  'model-lab/raw_intake/alice_in_wonderland.txt',
  'model-lab/raw_intake/pride_and_prejudice.txt',
  'model-lab/raw_intake/frankenstein.txt',
  'model-lab/raw_intake/war_room_package_manifest.json',
  'model-lab/raw_intake/sovereign_model_lab_governance.md',
  'model-lab/raw_intake/sovereign_model_lab_types_ts_sample.txt',
]

function walk(root: string, directory: string, files: string[]) {
  let entries: string[] = []
  try { entries = readdirSync(directory) } catch { return }
  for (const name of entries) {
    if (SKIP_DIR.has(name) || name.startsWith('.env')) continue
    const rel = relative(root, join(directory, name)).replaceAll('\\', '/')
    if (rel.startsWith('docs/WAVE_8_1_')) continue
    if (rel.startsWith('model-lab/manifests/wave8') || rel.startsWith('model-lab/manifests/wave8_1') || rel.startsWith('model-lab/manifests/wrim0_checkpoints')) continue
    const full = join(directory, name)
    let stat
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) walk(root, full, files)
    else if (stat.isFile() && stat.size > 0 && stat.size < 2_000_000) files.push(full)
  }
}

function classify(rel: string, text: string): { class: SourceClass; format: ExampleFormat; capabilityTags: string[]; rights: CorpusSourceInventoryRow['rights']; exclusionReasons: string[] } {
  const reasons: string[] = []
  if (INELIGIBLE_NAME.has(rel.split('/').pop() ?? '') || INELIGIBLE_SUFFIX.some(suffix => rel.toLowerCase().endsWith(suffix))) {
    return { class: 'INELIGIBLE', format: 'language_modeling', capabilityTags: [], rights: { licenseName: 'unknown', permitsTrainingUse: false, notes: 'binary or secret-adjacent' }, exclusionReasons: ['ineligible_file_type'] }
  }
  if (containsSecret(text)) reasons.push('secret_detected')
  if (containsHiddenCot(text)) reasons.push('hidden_cot_detected')
  if (rel.startsWith('model-lab/raw_intake/alice') || rel.includes('pride_and_prejudice') || rel.includes('frankenstein')) {
    return { class: 'ELIGIBLE', format: 'language_modeling', capabilityTags: ['language', 'literary-english'], rights: { licenseName: 'Public domain (Project Gutenberg)', permitsTrainingUse: true, notes: 'Already consumed as WR-CORPUS-0; inherited, not new unique tokens if same hash.' }, exclusionReasons: reasons }
  }
  if (rel.includes('raw_intake/')) {
    return { class: 'ELIGIBLE', format: rel.endsWith('.json') ? 'structured_json' : rel.endsWith('.txt') && rel.includes('types') ? 'code' : 'language_modeling', capabilityTags: ['language', 'code'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'WR-CORPUS-0 inherited commander-owned sample.' }, exclusionReasons: reasons }
  }
  if (rel.includes('.validation.ts') || rel.includes('engine.validation.ts')) {
    return { class: reasons.length ? 'INELIGIBLE' : 'ELIGIBLE', format: 'code', capabilityTags: ['code', 'evaluation-protocol'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'Validator source is Commander-owned; held-out eval items are assigned separately.' }, exclusionReasons: reasons }
  }
  if (rel.startsWith('docs/') || rel.endsWith('.md')) {
    return { class: reasons.length ? 'INELIGIBLE' : 'ELIGIBLE', format: 'language_modeling', capabilityTags: ['language', 'architecture', 'policy'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'Commander-owned War Room documentation.' }, exclusionReasons: reasons }
  }
  if (rel.endsWith('.sql')) {
    return { class: reasons.length ? 'INELIGIBLE' : 'ELIGIBLE', format: 'code', capabilityTags: ['schema-reasoning', 'code'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'Commander-owned schema.' }, exclusionReasons: reasons }
  }
  if (rel.endsWith('tokenizer.json') || rel.includes('/wrim0_tokenizer_')) {
    return { class: 'INELIGIBLE', format: 'structured_json', capabilityTags: [], rights: { licenseName: 'WR-TOKENIZER-0 artifact', permitsTrainingUse: false, notes: 'Tokenizer artifact is hashed, not used as unlabeled text.' }, exclusionReasons: ['tokenizer_artifact'] }
  }
  if (rel.endsWith('.json')) {
    return { class: reasons.length ? 'INELIGIBLE' : 'ELIGIBLE', format: 'structured_json', capabilityTags: ['structured-output'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'Commander-owned manifest/config. Checkpoints and tokenizer artifacts are hashed not trained as weights.' }, exclusionReasons: reasons }
  }
  if (/\.(ts|tsx|mjs|cjs|js)$/.test(rel)) {
    return { class: reasons.length ? 'INELIGIBLE' : 'ELIGIBLE', format: 'code', capabilityTags: ['code', 'tool-use'], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true, notes: 'Commander-owned War Room source.' }, exclusionReasons: reasons }
  }
  return { class: 'REQUIRES_REVIEW', format: 'language_modeling', capabilityTags: ['unknown'], rights: { licenseName: 'unknown', permitsTrainingUse: false, notes: 'Unclassified local material; not auto-admitted.' }, exclusionReasons: [...reasons, 'unclassified'] }
}

export function inventoryCorpusSources(repo = process.cwd()): CorpusSourceInventoryRow[] {
  const files: string[] = []
  for (const top of ['docs', 'lib', 'app', 'components', 'supabase', 'scripts', 'model-lab/raw_intake', 'model-lab/manifests']) {
    const full = join(repo, top)
    if (existsSync(full)) walk(repo, full, files)
  }
  for (const extra of ['CLAUDE.md', 'package.json', 'README.md']) {
    const full = join(repo, extra)
    if (existsSync(full)) files.push(full)
  }
  const rows: CorpusSourceInventoryRow[] = []
  const seen = new Set<string>()
  for (const full of files.sort()) {
    const rel = relative(repo, full).replaceAll('\\', '/')
    if (seen.has(rel)) continue
    seen.add(rel)
    if (rel.includes('wrim0_checkpoints/') && rel.endsWith('.safetensors')) continue
    if (rel.includes('wrim0_corpus_shards/') && rel.endsWith('.npy')) continue
    let text = ''
    try { text = readFileSync(full, 'utf8') } catch { continue }
    const classified = classify(rel, text)
    rows.push({
      sourceId: `src:${sha256(rel).slice(0, 16)}`,
      path: rel,
      class: classified.exclusionReasons.includes('secret_detected') ? 'INELIGIBLE' : classified.class,
      format: classified.format,
      capabilityTags: classified.capabilityTags,
      rights: classified.rights,
      provenanceRef: `repo-file:${rel}`,
      contentHash: sha256(text),
      normalizedHash: sha256(normalizeForDedup(text)),
      byteLength: Buffer.byteLength(text, 'utf8'),
      estimatedTokens: estimateUtf8Tokens(text),
      exclusionReasons: classified.class === 'INELIGIBLE' || classified.exclusionReasons.includes('secret_detected')
        ? [...new Set([...classified.exclusionReasons, ...(classified.exclusionReasons.includes('secret_detected') ? ['secret_detected'] : [])])]
        : classified.exclusionReasons.filter(reason => reason !== 'unclassified' || classified.class === 'REQUIRES_REVIEW'),
    })
  }
  return rows
}

export function wrCorpus0InheritedHashes(repo = process.cwd()): Set<string> {
  const hashes = new Set<string>()
  for (const rel of WR_CORPUS_0_INTAKE) {
    const full = join(repo, rel)
    if (!existsSync(full)) continue
    hashes.add(sha256(readFileSync(full, 'utf8')))
  }
  return hashes
}

export function summarizeInventory(rows: CorpusSourceInventoryRow[]) {
  const counts = { ELIGIBLE: 0, REQUIRES_REVIEW: 0, INELIGIBLE: 0, TEST_ONLY: 0, EVAL_ONLY: 0 }
  for (const row of rows) counts[row.class] += 1
  return counts
}
