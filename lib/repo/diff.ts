import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveRepoRoot } from './paths'

const execFileAsync = promisify(execFile)

const DEFAULT_MAX_BYTES = 512 * 1024

export type PreviewDiffOptions = {
  paths?: string[]
  staged?: boolean
  maxBytes?: number
}

function normalizePathSpecs(repoRoot: string, paths: string[] | undefined): string[] {
  if (!paths?.length) return []
  const root = path.resolve(repoRoot)
  const out: string[] = []
  for (const p of paths) {
    const trimmed = p.trim()
    if (!trimmed) continue
    const abs = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
    const rel = path.relative(root, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    out.push(rel.split(path.sep).join('/'))
  }
  return out
}

export async function previewDiff(options: PreviewDiffOptions = {}): Promise<{
  diff: string
  truncated: boolean
  staged: boolean
  repoPath: string
}> {
  const repoPath = resolveRepoRoot()
  const staged = Boolean(options.staged)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const specs = normalizePathSpecs(repoPath, options.paths)

  const baseArgs = staged ? ['diff', '--cached', '--no-color', '--no-ext-diff'] : ['diff', '--no-color', '--no-ext-diff']
  const args = [...baseArgs, '--', ...specs]

  let diff: string
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: Math.max(maxBytes * 4, 6 * 1024 * 1024),
    })
    diff = stdout
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('maxBuffer') || msg.includes('stdout maxBuffer')) {
      return { diff: '', truncated: true, staged, repoPath }
    }
    throw error
  }

  const buf = Buffer.byteLength(diff, 'utf8')
  if (buf <= maxBytes) {
    return { diff, truncated: false, staged, repoPath }
  }

  let slice = diff
  while (Buffer.byteLength(slice, 'utf8') > maxBytes && slice.length > 0) {
    slice = slice.slice(0, Math.floor(slice.length * 0.95))
  }
  return {
    diff: `${slice}\n\n… truncated (${buf} bytes → ~${Buffer.byteLength(slice, 'utf8')} bytes shown; cap ${maxBytes}).`,
    truncated: true,
    staged,
    repoPath,
  }
}

/** Used when storing checkpoint metadata (bounded sample). */
export function hashDiffSample(diff: string, maxSample = 64 * 1024): string {
  const sample = Buffer.byteLength(diff, 'utf8') <= maxSample ? diff : diff.slice(0, maxSample)
  return createHash('sha256').update(sample, 'utf8').digest('hex').slice(0, 32)
}
