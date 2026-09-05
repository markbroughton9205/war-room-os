import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export type TokenizerCategoryMetrics = {
  category: string
  chars: number
  tokens: number
  charsPerToken: number | null
}

export type TokenizerAnalysis = {
  tokenizerId: 'WR-TOKENIZER-0'
  tokenizerHash: string
  replaced: false
  method: 'huggingface-tokenizers' | 'unavailable'
  categories: TokenizerCategoryMetrics[]
  decision: string
}

const CATEGORY_SAMPLES: Record<string, string> = {
  english: 'The Commander operates War Room as a bounded orchestration platform with explicit approval gates.',
  code: 'export function evaluateContinuousEvidence(input: ContinuousEvidenceInput, now = new Date()) {\n  return input.source\n}\n',
  json: '{"datasetId":"w5ds_b6ddd9a332c3cc6816434712","trainingStarted":false,"splits":{"train":5,"validation":2,"test":1}}',
  urls: 'https://warroomos.com/api/search?q=terra+coverage https://docs.github.com/en/rest',
  coordinates: '43.6532,-79.3832 40.7128,-74.0060 validUntil=2026-08-30T19:00:00.000Z',
  numbers: '317338 2048000 19217152 0.003 512 8 500',
  scientific: 'temporal provenance validUntil observationRef predictionRef verificationAt geospatial bounding box',
  legal_policy: 'Commander-owned private repository. No training may start without explicit Commander authorization. Production remains untouched.',
  multilingual: 'Hello mundo. Bonjour. こんにちは. The corpus is English-primary; other scripts are incidental.',
}

export function analyzeTokenizer(repo = process.cwd()): TokenizerAnalysis {
  const tokenizerPath = join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')
  const tokenizerHash = existsSync(tokenizerPath) ? createHash('sha256').update(readFileSync(tokenizerPath)).digest('hex') : ''
  const script = join(repo, 'scripts/analyze-wr-tokenizer-0.py')
  const payload = JSON.stringify({ tokenizerPath, samples: CATEGORY_SAMPLES })
  const result = spawnSync('python3', [script], { input: payload, encoding: 'utf8', cwd: repo, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) {
    return {
      tokenizerId: 'WR-TOKENIZER-0', tokenizerHash, replaced: false, method: 'unavailable',
      categories: Object.entries(CATEGORY_SAMPLES).map(([category, text]) => ({ category, chars: text.length, tokens: 0, charsPerToken: null })),
      decision: 'WR-TOKENIZER-0 retained. Analyzer unavailable; no replacement trained or written.',
    }
  }
  const parsed = JSON.parse(result.stdout) as Record<string, { chars: number; tokens: number; charsPerToken: number | null }>
  const categories = Object.entries(parsed).map(([category, metrics]) => ({ category, ...metrics }))
  return {
    tokenizerId: 'WR-TOKENIZER-0', tokenizerHash, replaced: false, method: 'huggingface-tokenizers', categories,
    decision: 'WR-TOKENIZER-0 retained. No new tokenizer trained. Replacement would require a new immutable artifact in a distinct namespace after measured improvement.',
  }
}
