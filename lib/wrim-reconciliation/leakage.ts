import fs from 'node:fs'
import path from 'node:path'
import { defaultRecoveryDumpRoot } from '@/lib/wr-corpus/recoverySource'
import { dumpEvalOnlyDir } from './paths'

function collectPromptStrings(node: unknown, into: string[], depth = 0): void {
  if (depth > 8 || into.length > 400) return
  if (typeof node === 'string') {
    const t = node.trim()
    if (t.length >= 12 && t.length <= 400) into.push(t)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPromptStrings(item, into, depth + 1)
    return
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/prompt|text|input|query/i.test(k)) collectPromptStrings(v, into, depth + 1)
      else if (typeof v === 'object') collectPromptStrings(v, into, depth + 1)
    }
  }
}

function readJsonlHaystack(filePath: string, maxBytes = 12_000_000): string {
  if (!fs.existsSync(filePath)) return ''
  const stat = fs.statSync(filePath)
  const fd = fs.openSync(filePath, 'r')
  try {
    const n = Math.min(stat.size, maxBytes)
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, 0)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

export function checkDataLeakage(dumpRoot?: string | null) {
  const root = defaultRecoveryDumpRoot(dumpRoot)
  const corpus0 = path.join(root, 'sovereign-model-lab', 'corpora', 'WRM-001', '175af25fe1c17cf7630b506d0d6e6e88', 'corpus.jsonl')
  const corpus1Train = path.join(root, 'model-lab', 'corpora', 'WR-CORPUS-1-HARDENED', 'train', 'shard-00000.jsonl')
  const hay0 = readJsonlHaystack(corpus0)
  const hay1 = readJsonlHaystack(corpus1Train)
  const evalRoot = dumpEvalOnlyDir(dumpRoot)
  const hits: Array<{ suite: string; prompt: string; corpus0: boolean; corpus1: boolean }> = []
  if (fs.existsSync(evalRoot)) {
    for (const suite of fs.readdirSync(evalRoot)) {
      const suiteJson = path.join(evalRoot, suite, 'suite.json')
      const promptList = path.join(evalRoot, suite, 'prompt-list.json')
      const files = [suiteJson, promptList].filter(p => fs.existsSync(p))
      const prompts: string[] = []
      for (const f of files) {
        try {
          collectPromptStrings(JSON.parse(fs.readFileSync(f, 'utf8')), prompts)
        } catch {
          /* skip */
        }
      }
      const unique = [...new Set(prompts)].slice(0, 80)
      for (const prompt of unique) {
        const c0 = hay0.includes(prompt)
        const c1 = hay1.includes(prompt)
        if (c0 || c1) hits.push({ suite, prompt: prompt.slice(0, 120), corpus0: c0, corpus1: c1 })
      }
    }
  }
  return {
    method: 'Substring scan of eval-only suite.json/prompt-list.json against WR-CORPUS-0 jsonl and WR-CORPUS-1 train shard (first 12MB). No mutation. Recovery npy not loaded.',
    evalHitsInCorpus0: hits.filter(h => h.corpus0).length,
    evalHitsInCorpus1: hits.filter(h => h.corpus1).length,
    sampleHits: hits.slice(0, 20),
    historicalDisclosures: [
      'WRIM-0 genesis eval prompts are literary completions on the same WR-CORPUS-0 novels — expected domain overlap, not a hidden held-out.',
      'WRIM1-RUN-000001 train shards contained eval-infra source files (heldOut.ts/eval.ts/behavior.ts/GENESIS_REPORT). Fingerprint gate passed; substring leakage disclosed.',
      'WRIM1-RUN-000002 packed stream leak scan vs CAP-EVAL-0 = 0.',
      'Recovery-001 excluded 68 eval-infra records from its TEST_ONLY mix.',
    ],
    separationPolicy: 'eval-only directories remain EXCLUDE_FROM_TRAINING. Do not mix into WR-CORPUS-0/1 or future packs.',
  }
}
