import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const STATUS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'greeting.txt'), 'utf8').trim()

export function greeting() {
  return STATUS
}
