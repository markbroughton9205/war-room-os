#!/usr/bin/env node
/**
 * Wrapper around `playwright test` that reports an honest three-way verdict instead of letting
 * an all-skipped run masquerade as success. Playwright itself exits 0 when every test is skipped
 * (no TEST_COMMANDER_EMAIL/PASSWORD set) - the same exit code as a real pass - which is exactly
 * the false-green risk a CI/status check reading only the exit code would miss.
 *
 * Runs the suite exactly once (JSON reporter only - not run twice, to avoid a real authenticated
 * run double-executing a live Council round and wasting real Ollama compute) and prints the
 * per-test list itself from the parsed JSON, so nothing is lost versus the default reporter.
 *
 * Verdict:
 *   REAL BROWSER ACCEPTANCE: PASS          - at least one test actually ran and every run passed
 *   REAL BROWSER ACCEPTANCE: FAIL          - at least one test actually ran and failed
 *   REAL BROWSER ACCEPTANCE: NOT EXECUTED  - every test was skipped (no authenticated session) -
 *                                            this is an acceptable outcome, but must never be
 *                                            reported or treated as PASS.
 */
import { spawnSync } from 'node:child_process'

const jsonResult = spawnSync('pnpm', ['exec', 'playwright', 'test', '--reporter=json', ...process.argv.slice(2)], {
  env: process.env,
  shell: true,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})

if (jsonResult.stderr) process.stderr.write(jsonResult.stderr)

let parsed
try {
  parsed = JSON.parse(jsonResult.stdout)
} catch {
  console.error('Could not parse Playwright JSON output - reporting FAIL rather than guessing.')
  console.error((jsonResult.stdout ?? '(no stdout)').slice(0, 2000))
  console.log('\nREAL BROWSER ACCEPTANCE: FAIL')
  process.exit(1)
}

function walk(suites, out) {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({ title: spec.title, project: t.projectName, status: t.results?.[0]?.status ?? 'unknown' })
      }
    }
    walk(s.suites, out)
  }
}
const tests = []
walk(parsed.suites, tests)
for (const t of tests) console.log(`${t.status.toUpperCase().padEnd(9)} [${t.project}] ${t.title}`)

const { expected = 0, unexpected = 0, skipped = 0, flaky = 0 } = parsed.stats ?? {}
console.log(`\nPlaywright results: expected=${expected} unexpected=${unexpected} skipped=${skipped} flaky=${flaky}`)

if (unexpected > 0) {
  console.log('\nREAL BROWSER ACCEPTANCE: FAIL')
  process.exitCode = 1
} else if (expected === 0) {
  console.log('\nREAL BROWSER ACCEPTANCE: NOT EXECUTED (every test was skipped - set TEST_COMMANDER_EMAIL/TEST_COMMANDER_PASSWORD and re-run for real proof)')
  process.exitCode = 2
} else {
  console.log('\nREAL BROWSER ACCEPTANCE: PASS')
  process.exitCode = 0
}
