import { runFrk05Fixtures } from './later-fixtures'
import { reportPhase } from './phase-report'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

const kernel = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel')
const hits = readdirSync(kernel)
  .filter(name => name.endsWith('.ts') && !name.includes('validation') && name !== 'worker.ts')
  .reduce((count, name) => {
    const source = readFileSync(path.join(kernel, name), 'utf8')
    return count + (source.match(/from\s+['"][^'"]*(openai|anthropic|ollama|qwen|cursor|gemini|grok|xai)/gi) ?? []).length
  }, 0)
const results = runFrk05Fixtures()
results.push({ name: 'FRK_PROVIDER_SPECIFIC_CORE_IMPORT_COUNT', pass: hits === 0, detail: String(hits) })
reportPhase('FRK-05 deterministic suite', results)
