import { rm } from 'node:fs/promises'
import path from 'node:path'
import { resolveCorpusPaths } from './corpus'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

const paths = resolveCorpusPaths()
const root = path.resolve(paths.rootDir)
const repo = path.resolve(resolveBaseRepoRoot())
const defaultRoot = path.resolve(repo, '.war-room', 'sovereign-search')
if (!(root === defaultRoot || root.startsWith(path.join(repo, '.war-room') + path.sep))) {
  console.error(`Refusing to delete unexpected corpus path: ${root}`)
  process.exit(1)
}
await rm(root, { recursive: true, force: true })
console.log(`Removed ${root}`)
