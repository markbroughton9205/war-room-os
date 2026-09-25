/**
 * FRK-03 deterministic validator.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFrk03Fixtures, type Frk03Result } from './frk03-fixtures'
import { UNBOUNDED_META_REASONING_COUNT } from './types'

function sourceChecks(): Frk03Result[] {
  const root = resolveRepoRoot()
  const kernel = path.join(root, 'lib/native-builder/reasoning-kernel')
  const files = readdirSync(kernel).filter(name => name.endsWith('.ts') && !name.includes('validation'))
  const strategy = readFileSync(path.join(kernel, 'strategy-intelligence.ts'), 'utf8')
  const start = readFileSync(path.join(root, 'lib/native-builder/foundryMissionController.ts'), 'utf8')
  const resume = readFileSync(path.join(root, 'lib/native-builder/foundryOperationsManager.ts'), 'utf8')
  const panel = readFileSync(path.join(root, 'components/war-room/foundry/FoundryReasoningKernelSection.tsx'), 'utf8')
  const unbounded = files.reduce((count, name) => {
    const source = readFileSync(path.join(kernel, name), 'utf8')
    return count + (source.match(/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g) ?? []).length
  }, 0)
  return [
    { name: 'UNBOUNDED_META_REASONING_COUNT', pass: unbounded === UNBOUNDED_META_REASONING_COUNT && strategy.includes('META_STEP_CAP'), detail: String(unbounded) },
    { name: 'MISSION_START_HOOK', pass: start.includes("ensureLiveMissionReasoning(mission, 'START')"), detail: 'startMission' },
    { name: 'MISSION_RESUME_HOOK', pass: resume.includes("ensureLiveMissionReasoning(mission, 'RESUME')"), detail: 'resumeMissionRecord' },
    { name: 'REASONING_UI_STRATEGY', pass: panel.includes('Why:') && panel.includes('Previous Strategy:') && panel.includes('Trigger:'), detail: 'existing block' },
  ]
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'frk03-'))
  let results: Frk03Result[] = []
  try {
    const count = () => readdirSync(path.join(root, 'reasoning-sessions')).length
    results = [...await runFrk03Fixtures(root, count), ...sourceChecks()]
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  console.log(`${results.length - failed.length}/${results.length} PASS`)
  console.log('FRK-03 deterministic suite', failed.length ? 'FAIL' : 'PASS')
  if (failed.length) process.exit(1)
}

void main()
