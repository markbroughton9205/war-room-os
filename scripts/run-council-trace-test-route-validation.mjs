import { runCouncilTraceTestRouteValidation } from '../lib/council/traceTestRouteValidation.ts'

const results = await runCouncilTraceTestRouteValidation()
const failures = results.filter(result => !result.ok)

for (const result of results) {
  const status = result.ok ? 'PASS' : 'FAIL'
  console.log(`${status} ${result.name}`)
  if (!result.ok) {
    console.log(`  expected: ${result.expected}`)
    console.log(`  observed: ${result.observed}`)
  }
}

console.log(`Commander runtime diagnostics route validation: ${results.length - failures.length}/${results.length} PASS`)

if (failures.length > 0) {
  process.exitCode = 1
}
