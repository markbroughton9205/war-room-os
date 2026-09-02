import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildHeldOutSuite81, scoreHeldOutOutput, type HeldOutItem } from './heldOut'

export type Wrim0Baseline81Row = {
  evalId: string
  support: 'SUPPORTED' | 'UNSUPPORTED'
  status: string
  score: number | null
  output?: string
  outputSha256?: string
}

export function wrim0Baseline81(repo = process.cwd(), items = buildHeldOutSuite81()): Wrim0Baseline81Row[] {
  const livePath = join(repo, 'model-lab/manifests/wave8_1/wrim0-heldout-run.json')
  const live = existsSync(livePath)
    ? JSON.parse(readFileSync(livePath, 'utf8')) as { results: Array<{ evalId: string; output: string; outputSha256: string }> }
    : { results: [] }
  const genesisPath = join(repo, 'model-lab/manifests/wrim0_eval_results.json')
  const genesis = existsSync(genesisPath)
    ? JSON.parse(readFileSync(genesisPath, 'utf8')) as { fixedPromptResults: Array<{ id: string; prompt: string; output: string; outputSha256: string; validJson?: boolean }> }
    : { fixedPromptResults: [] }

  return items.map(item => {
    const liveRow = live.results.find(row => row.evalId === item.evalId)
    if (item.wrim0Support === 'UNSUPPORTED') {
      return {
        evalId: item.evalId, support: 'UNSUPPORTED', score: null,
        status: 'unsupported_by_current_wrim0_runtime',
        output: liveRow?.output, outputSha256: liveRow?.outputSha256,
      }
    }
    if (liveRow) {
      return {
        evalId: item.evalId, support: 'SUPPORTED', status: 'live_wrim0_heldout_run',
        score: scoreHeldOutOutput(item, liveRow.output),
        output: liveRow.output, outputSha256: liveRow.outputSha256,
      }
    }
    const genesisRow = genesis.fixedPromptResults.find(row => row.prompt === item.input)
    if (genesisRow) {
      const score = item.objectiveScorer === 'json-validity' ? (genesisRow.validJson ? 1 : 0) : null
      return {
        evalId: item.evalId, support: 'SUPPORTED', status: 'recorded_genesis_eval',
        score, output: genesisRow.output, outputSha256: genesisRow.outputSha256,
      }
    }
    return { evalId: item.evalId, support: 'SUPPORTED', status: 'supported_but_no_recorded_run', score: null }
  })
}

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function scoreItem(item: HeldOutItem, output: string) {
  return scoreHeldOutOutput(item, output)
}
