import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** The interpreter with the `tokenizers` package: an explicit override, this project's own Linux ML venv, else a bare python3 on PATH. */
function tokenizerPython(): string {
  const override = process.env.WAR_ROOM_PYTHON?.trim()
  if (override && existsSync(override)) return override
  const linuxVenv = join(homedir(), '.local/share/war-room-os/venvs/wrim-pytorch-linux/bin/python')
  if (process.platform === 'linux' && existsSync(linuxVenv)) return linuxVenv
  return 'python3'
}

export type TokenizerCount = {
  chars: number
  bytes: number
  tokens: number
  charsPerToken: number | null
  bytesPerToken: number | null
}

export function tokenizerArtifactHash(repo = process.cwd()): string {
  const path = join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')
  if (!existsSync(path)) return ''
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function countWithWrTokenizer0(
  items: Array<{ id: string; text: string }>,
  repo = process.cwd(),
): { method: 'huggingface-tokenizers' | 'unavailable'; counts: Record<string, TokenizerCount> } {
  const tokenizerPath = join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')
  const script = join(repo, 'scripts/count-wr-tokenizer-0.py')
  if (!existsSync(tokenizerPath) || !existsSync(script) || items.length === 0) {
    return { method: 'unavailable', counts: {} }
  }
  const payloadPath = join(tmpdir(), `wave81-tokenize-${process.pid}.json`)
  writeFileSync(payloadPath, JSON.stringify({ tokenizerPath, items }))
  const result = spawnSync(tokenizerPython(), [script], {
    input: readFileSync(payloadPath),
    encoding: 'utf8',
    cwd: repo,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) return { method: 'unavailable', counts: {} }
  return { method: 'huggingface-tokenizers', counts: JSON.parse(result.stdout) as Record<string, TokenizerCount> }
}
