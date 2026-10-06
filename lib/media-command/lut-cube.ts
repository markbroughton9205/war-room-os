/**
 * Minimal .cube writer + validator for HVS-owned fixtures. Not a third-party LUT pack.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'

export function writeGainCube(opts: { name: string; size?: number; r?: number; g?: number; b?: number }): string {
  const size = opts.size ?? 17
  const r = opts.r ?? 1
  const g = opts.g ?? 1
  const b = opts.b ?? 1
  const lines = [
    `# HVS-owned fixture LUT. Not a vendor pack.`,
    `TITLE "${opts.name}"`,
    `LUT_3D_SIZE ${size}`,
  ]
  for (let zi = 0; zi < size; zi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let xi = 0; xi < size; xi++) {
        const x = xi / (size - 1)
        const y = yi / (size - 1)
        const z = zi / (size - 1)
        lines.push(`${(x * r).toFixed(6)} ${(y * g).toFixed(6)} ${(z * b).toFixed(6)}`)
      }
    }
  }
  const dir = path.join(mediaCommandDataHierarchy().fixtures, 'hvs-luts')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${opts.name}.cube`)
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  return file
}

export type CubeValidation = { ok: boolean; errors: string[]; size: number | null; samples: number }

function isInsideMediaCommand(file: string): boolean {
  const root = mediaCommandDataHierarchy().mediaCommandRoot
  const resolved = path.resolve(file)
  return resolved.startsWith(path.resolve(root)) || resolved.startsWith(path.resolve(process.cwd(), 'application-data'))
}

export function validateCubeFile(file: string): CubeValidation {
  const errors: string[] = []
  if (!file || file.includes('..') || file.includes('\0')) errors.push('LUT path rejected.')
  if (file && !isInsideMediaCommand(file) && !file.includes('hvs-luts') && !file.endsWith('.cube')) {
    errors.push('LUT must be a project-linked .cube under media-command storage.')
  }
  let size: number | null = null
  let samples = 0
  try {
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const sizeMatch = line.match(/^LUT_3D_SIZE\s+(\d+)/i)
      if (sizeMatch) {
        size = Number(sizeMatch[1])
        if (!Number.isInteger(size) || size < 2 || size > 65) errors.push('LUT_3D_SIZE out of range.')
        continue
      }
      if (/^LUT_1D_SIZE/i.test(line)) {
        errors.push('1D LUT is not supported this wave.')
        continue
      }
      if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) continue
      const parts = line.split(/\s+/)
      if (parts.length === 3) {
        const nums = parts.map(Number)
        if (nums.some(n => !Number.isFinite(n))) errors.push('LUT sample is not finite.')
        samples += 1
      }
    }
    if (size == null) errors.push('Missing LUT_3D_SIZE.')
    else if (samples !== size * size * size) errors.push(`Expected ${size ** 3} samples, got ${samples}.`)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'LUT unreadable.')
  }
  return { ok: errors.length === 0, errors, size, samples }
}
