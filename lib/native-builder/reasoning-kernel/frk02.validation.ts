/**
 * FRK-02 deterministic validator.
 * Does not call a model, package, install, activate, or deploy.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { runFrk02Fixtures, type Frk02Result } from './frk02-fixtures'
import {
  DUPLICATE_REASONING_SESSION_COUNT,
  FRK_DIRECT_FILESYSTEM_WRITE_COUNT,
  FRK_REPEATED_FAILED_BRANCH_WITHOUT_REPLAN_COUNT,
  FRK_SEARCH_PROVIDER_DEPENDENCY_COUNT,
  RAW_CHAIN_OF_THOUGHT_STORED_COUNT,
  REPLAYED_MUTATION_AFTER_RESTART_COUNT,
  SECOND_REASONING_TRUTH_COUNT,
  UNBOUNDED_REASONING_LOOP_COUNT,
} from './types'

function kernelFiles(): Array<{ name: string; source: string }> {
  const dir = path.join(resolveRepoRoot(), 'lib/native-builder/reasoning-kernel')
  return readdirSync(dir)
    .filter(name => name.endsWith('.ts') && !name.includes('validation'))
    .map(name => ({ name, source: readFileSync(path.join(dir, name), 'utf8') }))
}

function sourceChecks(): Frk02Result[] {
  const files = kernelFiles()
  const searchFiles = ['search.ts', 'attachment.ts', 'persistence.ts', 'brief-view.ts', 'frk02-fixtures.ts']
  const searchBlob = files.filter(file => searchFiles.includes(file.name)).map(file => file.source).join('\n')
  const providerHits = (searchBlob.match(/from\s+['"][^'"]*foundryModelRouter['"]/g) ?? []).length
  const mutationWrites = files
    .filter(file => file.name !== 'persistence.ts')
    .reduce((count, file) => count + (file.source.match(/\b(writeFile|appendFile|createWriteStream|rmSync|mkdirSync)\b/g) ?? []).length, 0)
  const unbounded = files.reduce((count, file) => count + (file.source.match(/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g) ?? []).length, 0)
  const privateFields = files.reduce((count, file) => count + (file.source.match(/\b(chainOfThought|scratchpad|hiddenReasoning)\s*:/g) ?? []).length, 0)
  const positiveReplan = files.reduce((count, file) => count + (file.source.match(/repeatedFailedWithoutReplan\s*=\s*[1-9]/g) ?? []).length, 0)
  const view = readFileSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryMissionView.ts'), 'utf8')
  const panel = readFileSync(path.join(resolveRepoRoot(), 'components/war-room/foundry/FoundryReasoningKernelSection.tsx'), 'utf8')
  return [
    { name: 'SECOND_REASONING_TRUTH_COUNT', pass: SECOND_REASONING_TRUTH_COUNT === 0 && searchBlob.includes('cannot store a second reasoning graph'), detail: String(SECOND_REASONING_TRUTH_COUNT) },
    { name: 'FRK_SEARCH_PROVIDER_DEPENDENCY_COUNT', pass: providerHits === FRK_SEARCH_PROVIDER_DEPENDENCY_COUNT, detail: String(providerHits) },
    { name: 'FRK_REPEATED_FAILED_BRANCH_WITHOUT_REPLAN_COUNT', pass: positiveReplan === FRK_REPEATED_FAILED_BRANCH_WITHOUT_REPLAN_COUNT, detail: String(positiveReplan) },
    { name: 'FRK_DIRECT_FILESYSTEM_WRITE_COUNT', pass: mutationWrites === FRK_DIRECT_FILESYSTEM_WRITE_COUNT, detail: String(mutationWrites) },
    { name: 'RAW_CHAIN_OF_THOUGHT_STORED_COUNT', pass: privateFields === RAW_CHAIN_OF_THOUGHT_STORED_COUNT, detail: String(privateFields) },
    { name: 'UNBOUNDED_REASONING_LOOP_COUNT', pass: unbounded === UNBOUNDED_REASONING_LOOP_COUNT, detail: String(unbounded) },
    { name: 'MISSION_VIEW_BRIEF', pass: view.includes('reasoningSessionId') && view.includes('reasoningBrief') && view.includes('reasoningStatus') && view.includes('reasoningUpdatedAt'), detail: 'commander view carries the pointer' },
    { name: 'MISSION_UI_BRIEF', pass: panel.includes('reasoningPanelModel') && panel.includes('Search Branches') && panel.includes('Next Action'), detail: 'panel reads the persisted brief' },
  ]
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'frk02-'))
  let results: Frk02Result[] = []
  try {
    results = [...await runFrk02Fixtures(root), ...sourceChecks()]
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const replayed = results.find(item => item.name === 'FIXTURE_H')
  const duplicates = results.find(item => item.name === 'DUPLICATE_SESSION')
  results.push({
    name: 'REPLAYED_MUTATION_AFTER_RESTART_COUNT',
    pass: Boolean(replayed?.pass) && REPLAYED_MUTATION_AFTER_RESTART_COUNT === 0,
    detail: String(REPLAYED_MUTATION_AFTER_RESTART_COUNT),
  })
  results.push({
    name: 'DUPLICATE_REASONING_SESSION_COUNT',
    pass: Boolean(duplicates?.pass) && DUPLICATE_REASONING_SESSION_COUNT === 0,
    detail: String(DUPLICATE_REASONING_SESSION_COUNT),
  })
  const failed = results.filter(item => !item.pass)
  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  console.log(`${results.length - failed.length}/${results.length} PASS`)
  console.log('FRK-02 deterministic suite', failed.length ? 'FAIL' : 'PASS')
  if (failed.length) process.exit(1)
}

void main()
