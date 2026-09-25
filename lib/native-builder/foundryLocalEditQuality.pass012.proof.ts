/**
 * PASS 012 — ten controlled local-14B bounded-edit fixtures.
 * Measures first-attempt apply rate. No production file. No force patch.
 */
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { startMission, runModelMission } from './foundryMissionController'
import { saveMission } from './foundryMissionStore'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import { resolveLocalModelHealth } from './localModelHealth'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { resolveRepoRoot } from '@/lib/repo/paths'

const ROOT = resolveRepoRoot()
const DIR = 'scripts/foundry/bounded-edit/pass012'

function fixtureRequest(file: string, task: string): string {
  return `Edit ONLY ${file}. ${task} Search for that exact path, focused-read it, then file.replace_unique using the returned anchorId. Do not edit components/, app/, lib/, or any other file. This is a test application fixture, not a production install.`
}

type Fixture = {
  id: string
  file: string
  source: string
  request: string
  expect: (text: string) => boolean
}

const FIXTURES: Fixture[] = [
  {
    id: 'jsx-binding',
    file: `${DIR}/jsx-binding.tsx`,
    source: 'export function Chip(selected: { value: string }) {\n  return <p data-testid="chip">{selected.value}</p>\n}\n',
    request: fixtureRequest(`${DIR}/jsx-binding.tsx`, 'Keep selected.value and add the word ready after it.'),
    expect: text => /selected\.value/.test(text) && /ready/.test(text),
  },
  {
    id: 'object-field',
    file: `${DIR}/object-field.ts`,
    source: 'export const FLAGS = { alpha: true, beta: false }\n',
    request: fixtureRequest(`${DIR}/object-field.ts`, 'Set FLAGS.beta to true. Keep FLAGS.alpha.'),
    expect: text => /alpha:\s*true/.test(text) && /beta:\s*true/.test(text),
  },
  {
    id: 'function-call',
    file: `${DIR}/function-call.ts`,
    source: 'export function greet(name: string) {\n  return formatName(name)\n}\n',
    request: fixtureRequest(`${DIR}/function-call.ts`, 'Keep formatName(name) and prefix the return with "hi ".'),
    expect: text => /formatName\(name\)/.test(text) && /hi /.test(text),
  },
  {
    id: 'text-node',
    file: `${DIR}/text-node.tsx`,
    source: 'export function Label() {\n  return <span>UNIQUE_PASS012_TEXT_ALPHA</span>\n}\n',
    request: fixtureRequest(`${DIR}/text-node.tsx`, 'Change UNIQUE_PASS012_TEXT_ALPHA to UNIQUE_PASS012_TEXT_BETA.'),
    expect: text => text.includes('UNIQUE_PASS012_TEXT_BETA') && !text.includes('UNIQUE_PASS012_TEXT_ALPHA'),
  },
  {
    id: 'conditional',
    file: `${DIR}/conditional.tsx`,
    source: 'export function Gate(selected: { ok: boolean }) {\n  return <p>{selected.ok ? "YES" : "NO"}</p>\n}\n',
    request: fixtureRequest(`${DIR}/conditional.tsx`, 'Keep the selected.ok ternary and add data-testid="gate".'),
    expect: text => /selected\.ok \?/.test(text) && /data-testid="gate"/.test(text),
  },
  {
    id: 'sibling-detail',
    file: `${DIR}/sibling-detail.tsx`,
    source: 'export function Review(selected: { status: string; statusDetail?: string }) {\n  return <p>{selected.status}</p>\n}\n',
    request: fixtureRequest(`${DIR}/sibling-detail.tsx`, 'Keep selected.status and also render selected.statusDetail.'),
    expect: text => /selected\.status(?![A-Za-z])/.test(text) && /selected\.statusDetail/.test(text),
  },
  {
    id: 'import-preserve',
    file: `${DIR}/import-preserve.ts`,
    source: 'import { helper } from "./helper.ts"\nexport const VALUE = helper("alpha")\n',
    request: fixtureRequest(`${DIR}/import-preserve.ts`, 'Keep the helper import and change "alpha" to "beta".'),
    expect: text => /import \{ helper \}/.test(text) && /helper\("beta"\)/.test(text),
  },
  {
    id: 'multiline',
    file: `${DIR}/multiline.ts`,
    source: 'export function block() {\n  const one = 1\n  const two = 2\n  return one + two\n}\n',
    request: fixtureRequest(`${DIR}/multiline.ts`, 'Keep one and two and return one * two instead of one + two.'),
    expect: text => /const one = 1/.test(text) && /const two = 2/.test(text) && /one \* two/.test(text),
  },
  {
    id: 'jsx-class',
    file: `${DIR}/jsx-class.tsx`,
    source: 'export function Row(props: { label: string }) {\n  return <div className="row">{props.label}</div>\n}\n',
    request: fixtureRequest(`${DIR}/jsx-class.tsx`, 'Keep props.label and className="row" and add data-testid="row".'),
    expect: text => /props\.label/.test(text) && /className="row"/.test(text) && /data-testid="row"/.test(text),
  },
  {
    id: 'object-literal',
    file: `${DIR}/object-literal.ts`,
    source: 'export const POINT = {\n  x: 1,\n  y: 2,\n}\n',
    request: fixtureRequest(`${DIR}/object-literal.ts`, 'Keep x and y and add z: 3.'),
    expect: text => /x:\s*1/.test(text) && /y:\s*2/.test(text) && /z:\s*3/.test(text),
  },
]

function writeFixture(item: Fixture) {
  mkdirSync(path.join(ROOT, DIR), { recursive: true })
  writeFileSync(path.join(ROOT, item.file), item.source)
}

async function runOne(item: Fixture) {
  writeFixture(item)
  const mission = await startMission(item.request)
  mission.candidateFiles = [item.file]
  mission.importantPaths = [item.file]
  ensureEngineeringState(mission).allowedChangeSet = [item.file]
  await saveMission(mission)
  const run = await runModelMission(mission.missionId)
  const abs = path.join(ROOT, item.file)
  const after = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const replaces = run.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const first = replaces[0]
  const firstApplied = Boolean(first?.ok)
  const invalidReplacementCount = replaces.filter(call => /INVALID_REPLACEMENT/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`)).length
  run.testArtifact = true
  run.visibility = 'system'
  run.resumeEligible = false
  run.archived = true
  await archiveConfirmedSystemTestMission(run).catch(() => undefined)
  await releaseMissionResources(run.missionId).catch(() => undefined)
  writeFixture(item)
  return {
    id: item.id,
    missionId: run.missionId,
    status: run.status,
    firstAttemptApplied: firstApplied,
    invalidReplacementCount,
    retryCount: Math.max(0, replaces.length - 1),
    mutated: item.expect(after),
    replaces: replaces.length,
    provider: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
  }
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const health = await resolveLocalModelHealth({ tryStart: true })
  if (health.state !== 'READY' || !/qwen2.5-coder:14b/.test(health.model ?? '')) {
    console.log(`FAIL local_health ${JSON.stringify(health)}`)
    process.exit(1)
  }
  const rows: Awaited<ReturnType<typeof runOne>>[] = []
  const finish = (code: number) => {
    persistFoundryRuntimeConfig({
      primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
      fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
      providerPolicy: 'AUTO',
    })
    if (rows.length) {
      const firstAttemptApplyRate = rows.filter(item => item.firstAttemptApplied && item.mutated).length / rows.length
      const invalidReplacementCount = rows.reduce((sum, item) => sum + item.invalidReplacementCount, 0)
      const retryCount = rows.reduce((sum, item) => sum + item.retryCount, 0)
      console.log(JSON.stringify({ FIRST_ATTEMPT_APPLY_RATE: firstAttemptApplyRate, invalidReplacementCount, retryCount, rows }, null, 2))
    }
    process.exit(code)
  }
  process.once('SIGTERM', () => finish(1))
  process.once('SIGINT', () => finish(1))
  for (const item of FIXTURES) {
    const row = await runOne(item)
    rows.push(row)
    console.log(`${row.firstAttemptApplied && row.mutated ? 'PASS' : 'INFO'} edit ${JSON.stringify(row)}`)
  }
  const firstAttemptApplyRate = rows.filter(item => item.firstAttemptApplied && item.mutated).length / rows.length
  const invalidReplacementCount = rows.reduce((sum, item) => sum + item.invalidReplacementCount, 0)
  const retryCount = rows.reduce((sum, item) => sum + item.retryCount, 0)
  const allSafe = rows.every(item => item.status === 'COMPLETE' || item.status === 'BLOCKED' || item.mutated)
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    FIRST_ATTEMPT_APPLY_RATE: firstAttemptApplyRate,
    invalidReplacementCount,
    retryCount,
    rows,
  }, null, 2))
  if (firstAttemptApplyRate < 0.8 || !allSafe) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
