import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeText, decodeIds } from '@/lib/wr-tokenizer/encode'
import { dumpTokenizerPath } from '@/lib/wr-tokenizer/inspect'
import { resolveWrTokenizerPaths } from '@/lib/wr-tokenizer/paths'
import { pythonExecutable } from './stack'
import { dumpWrim0FinalWeights } from './paths'

export type IsolatedInferenceResult = {
  attempted: boolean
  feasibleWithoutConversion: boolean
  conversionRequired: string
  ok: boolean
  detail: string
  generatedText?: string
  argmaxId?: number
  entropy?: number
  finite?: boolean
  wroteWeights: false
}

export function isolatedWrim0InferenceSmoke(opts?: {
  dumpRoot?: string | null
  dataDirOverride?: string | null
}): IsolatedInferenceResult {
  const conversionRequired =
    'Production CUDA training/inference requires a PyTorch (or other CUDA) port of WRIM0Model that loads model.* F32 tensors and discards MLX opt.* state. Do not overwrite the original safetensors file.'
  const weights = dumpWrim0FinalWeights(opts?.dumpRoot)
  const py = pythonExecutable()
  const tokPaths = resolveWrTokenizerPaths(opts?.dataDirOverride)
  const tokFile = fs.existsSync(tokPaths.tokenizerJson) ? tokPaths.tokenizerJson : dumpTokenizerPath(opts?.dumpRoot)
  if (!fs.existsSync(weights)) {
    return {
      attempted: false,
      feasibleWithoutConversion: false,
      conversionRequired,
      ok: false,
      detail: 'WRIM-0 weights missing',
      wroteWeights: false,
    }
  }
  if (!py) {
    return {
      attempted: false,
      feasibleWithoutConversion: false,
      conversionRequired,
      ok: false,
      detail: 'No Windows Python with numpy for isolated smoke',
      wroteWeights: false,
    }
  }
  const encoded = encodeText('The sky is', tokFile)
  const ids = [1, ...encoded.ids]
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'wrim-reconciliation', 'isolated_numpy_infer.py')
  try {
    const out = execFileSync(py, [script, '--weights', weights, '--ids', ids.join(','), '--new-tokens', '8'], {
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    const json = JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? '{}') as {
      ok?: boolean
      new_ids?: number[]
      argmax_id?: number
      entropy?: number
      finite?: boolean
      error?: string
    }
    const generatedText = decodeIds(json.new_ids ?? [], tokFile, true)
    return {
      attempted: true,
      feasibleWithoutConversion: json.ok === true,
      conversionRequired,
      ok: json.ok === true && json.finite === true,
      detail: json.ok ? 'numpy isolated greedy smoke on dump weights (read-only)' : String(json.error ?? 'infer failed'),
      generatedText,
      argmaxId: json.argmax_id,
      entropy: json.entropy,
      finite: json.finite,
      wroteWeights: false,
    }
  } catch (error) {
    return {
      attempted: true,
      feasibleWithoutConversion: false,
      conversionRequired,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      wroteWeights: false,
    }
  }
}
