/**
 * Deterministic Foundry Reasoning Kernel validator.
 * Does not call a model, write product files, package, install, or deploy.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  FRK_CURSOR_DEPENDENCY_COUNT,
  FRK_DIRECT_FILESYSTEM_WRITE_COUNT,
  FRK_QWEN_DEPENDENCY_COUNT,
  RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
  UNBOUNDED_REASONING_LOOP_COUNT,
} from './types'
import { runFixtureSuite, type FixtureResult } from './fixtures'

function kernelFiles(): Array<{ name: string; source: string }> {
  const dir = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel')
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts') && !name.includes('validation'))
    .map(name => ({ name, source: readFileSync(path.join(dir, name), 'utf8') }))
}

function kernelSources(): string[] {
  return kernelFiles().map(file => file.source)
}

function sourceChecks(): FixtureResult[] {
  const sources = kernelSources()
  const blob = sources.join('\n')
  const importHits = (pattern: RegExp) => sources.reduce((count, source) => count + (source.match(pattern) ?? []).length, 0)
  const qwen = importHits(/from\s+['"][^'"]*(qwen|ollama)/gi)
  const cursor = importHits(/from\s+['"][^'"]*cursor/gi)
  const writes = kernelFiles()
    .filter(file => file.name !== 'persistence.ts')
    .reduce((count, file) => count + (file.source.match(/\b(writeFile|appendFile|createWriteStream|rmSync|mkdirSync)\b/g) ?? []).length, 0)
  const unbounded = importHits(/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g)
  const privateFields = importHits(/\b(chainOfThought|scratchpad|hiddenReasoning)\s*:/g)
  const results: FixtureResult[] = []
  results.push({ name: 'FRK_QWEN_DEPENDENCY_COUNT', pass: qwen === FRK_QWEN_DEPENDENCY_COUNT, detail: String(qwen) })
  results.push({ name: 'FRK_CURSOR_DEPENDENCY_COUNT', pass: cursor === FRK_CURSOR_DEPENDENCY_COUNT, detail: String(cursor) })
  results.push({ name: 'FRK_DIRECT_FILESYSTEM_WRITE_COUNT', pass: writes === FRK_DIRECT_FILESYSTEM_WRITE_COUNT, detail: String(writes) })
  results.push({ name: 'UNBOUNDED_REASONING_LOOP_COUNT', pass: unbounded === UNBOUNDED_REASONING_LOOP_COUNT, detail: String(unbounded) })
  results.push({ name: 'RAW_CHAIN_OF_THOUGHT_STORED_COUNT', pass: privateFields === RAW_CHAIN_OF_THOUGHT_STORED_COUNT && !/\bchainOfThought\b/.test(blob), detail: String(privateFields) })
  results.push({
    name: 'MODEL_INDEPENDENT_CORE',
    pass: !/from\s+['"][^'"]*foundryModelRouter['"]/.test(blob) || sources.length > 0 && !kernelSources().filter(source => !source.includes('dispatchReasoningWorker')).some(source => /foundryModelRouter/.test(source)),
    detail: 'router import stays on the worker adapter',
  })
  const workerOnly = sources.filter(source => source.includes('dispatchReasoningWorker'))
  const core = sources.filter(source => !source.includes('dispatchReasoningWorker'))
  results.push({
    name: 'FRK_CORE_MODEL_INDEPENDENT',
    pass: core.every(source => !source.includes('foundryModelRouter')) && workerOnly.length === 1,
    detail: `coreFiles=${core.length}`,
  })
  return results
}

export function runDeterministicSuite(): FixtureResult[] {
  return [...runFixtureSuite(), ...sourceChecks()]
}

const results = runDeterministicSuite()
const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
console.log(`${results.length - failed.length}/${results.length} PASS`)
console.log('FRK deterministic suite', failed.length ? 'FAIL' : 'PASS')
if (failed.length) process.exit(1)
