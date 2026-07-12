import { runAppleReminderBridgeValidation } from '../lib/council/apple-reminders-bridge/appleReminderBridgeValidation.ts'
import { runAppleReminderLiveRouteValidation } from '../lib/council/apple-reminder-live-route/validation.ts'
import { runAutoModeLedgerValidation } from '../lib/council/auto-mode-ledger/validation.ts'
import { runAutoModeLedgerNegativeControls } from '../lib/council/auto-mode-ledger/negativeControls.ts'
import { runLedgerUuidRegressionValidation } from '../lib/council/auto-mode-ledger/uuidRegression.ts'
import { runGate14ApprovalAuthorityValidation } from '../lib/council/approval-authority/validation.ts'
import { runApprovalAuthorityHardeningValidation } from '../lib/council/approval-authority/hardeningValidation.ts'
import { runGate16ActionRoutePolicyValidation } from '../lib/security/actionRoutePolicyValidation.ts'
import { existsSync, readFileSync } from 'node:fs'

loadDotEnvLocal()

const suites = [
  ['46K apple reminder bridge', () => runAppleReminderBridgeValidation()],
  ['46O apple reminder live route', () => runAppleReminderLiveRouteValidation()],
  ['46L/46M auto-mode ledger', () => runAutoModeLedgerValidation()],
  ['46L/46M negative controls', () => runAutoModeLedgerNegativeControls()],
  ['46O-H UUID regression', () => runLedgerUuidRegressionValidation()],
  ['46N Gate 14 approval authority', () => runGate14ApprovalAuthorityValidation()],
  ['46O-H approval authority hardening', () => runApprovalAuthorityHardeningValidation()],
  ['46P-A action route policy', () => runGate16ActionRoutePolicyValidation()],
]

let total = 0
let passed = 0
let failed = 0

for (const [name, run] of suites) {
  console.log(`\n== ${name} ==`)
  const results = await run()
  for (const result of results) {
    total += 1
    if (result.result === 'PASS' || result.result === 'LIMITATION_ACCEPTED') {
      passed += 1
    } else {
      failed += 1
    }
    const status = result.result ?? 'UNKNOWN'
    const id = result.caseId ?? result.id ?? 'unknown_case'
    const observed = result.observed ?? result.status ?? ''
    console.log(`${status} ${id}${observed ? `: ${observed}` : ''}`)
  }
}

console.log(`\nPhase 46 regression sweep: ${passed}/${total} non-failing, ${failed} failing`)
if (failed > 0) process.exitCode = 1

function loadDotEnvLocal() {
  if (!existsSync('.env.local')) return
  const content = readFileSync('.env.local', 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (!key || process.env[key] !== undefined) continue
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
