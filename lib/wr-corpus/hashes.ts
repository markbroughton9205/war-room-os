/**
 * SHA-256 helpers for WR-CORPUS integrity. Never silently rebuild on mismatch.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

export function sha256Buffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk as Buffer))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

export async function sha256FileOrThrow(filePath: string, expected: string, label: string): Promise<string> {
  const actual = await sha256File(filePath)
  if (actual !== expected) {
    throw new WrCorpusIntegrityError(
      `HASH_MISMATCH ${label}: expected ${expected} got ${actual}. STOP. Do not silently rebuild.`,
    )
  }
  return actual
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

export class WrCorpusIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WrCorpusIntegrityError'
  }
}

export class WrCorpusPolicyError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'WrCorpusPolicyError'
    this.code = code
  }
}
