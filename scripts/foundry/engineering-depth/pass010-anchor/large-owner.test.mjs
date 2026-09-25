import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const owner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'large-owner.mjs')
const text = readFileSync(owner, 'utf8')
if (!text.includes('UNIQUE_EDIT_ANCHOR_BETA')) {
  console.error('expected UNIQUE_EDIT_ANCHOR_BETA after bounded anchor edit')
  process.exit(1)
}
if (text.includes('UNIQUE_EDIT_ANCHOR_ALPHA')) {
  console.error('UNIQUE_EDIT_ANCHOR_ALPHA should have been replaced')
  process.exit(1)
}
console.log('pass010-anchor fixture ok')
