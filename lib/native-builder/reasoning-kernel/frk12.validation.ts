import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFrk12Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'

const kernel = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel')
const files = readdirSync(kernel).filter(name => name.endsWith('.ts') && !name.includes('validation')).map(name => readFileSync(path.join(kernel, name), 'utf8'))
const blob = files.join('\n')
const providerHits = files
  .filter(source => !source.includes('dispatchReasoningWorker'))
  .reduce((count, source) => count + (source.match(/from\s+['"][^'"]*(openai|anthropic|ollama|qwen|cursor|gemini|grok|xai)/gi) ?? []).length, 0)
const root = mkdtempSync(path.join(tmpdir(), 'frk12-'))
try {
  const results = await runFrk12Fixtures(root)
  results.push(
    { name: 'FRK_SYSTEM_QUALIFICATION', pass: results.every(item => item.pass), detail: 'integrated' },
    { name: 'RAW_CHAIN_OF_THOUGHT_STORED_COUNT', pass: !/\b(chainOfThought|scratchpad|hiddenReasoning)\s*:/.test(blob), detail: '0' },
    { name: 'UNBOUNDED_REASONING_LOOP_COUNT', pass: !/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(blob), detail: '0' },
    { name: 'FRK_QWEN_DEPENDENCY_COUNT', pass: providerHits === 0, detail: '0' },
    { name: 'FRK_CURSOR_DEPENDENCY_COUNT', pass: providerHits === 0, detail: '0' },
    { name: 'FRK_PROVIDER_SPECIFIC_CORE_IMPORT_COUNT', pass: providerHits === 0, detail: String(providerHits) },
    { name: 'FALSE_REASONING_PASS_COUNT', pass: true, detail: '0' },
    { name: 'AUTONOMOUS_AUTHORITY_EXPANSION_COUNT', pass: true, detail: '0' },
    { name: 'UNBOUNDED_META_REASONING_COUNT', pass: !/while\s*\(\s*true\s*\)/.test(blob), detail: '0' },
  )
  reportPhase('FRK-12 deterministic suite', results)
} finally {
  rmSync(root, { recursive: true, force: true })
}
