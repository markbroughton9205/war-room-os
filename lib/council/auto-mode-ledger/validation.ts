import { runAppleReminderBridgeValidation } from '../apple-reminders-bridge'
import { validateLiveFeatureRegistry } from './LiveFeatureRegistry'
import { runGate11DurableReplayValidation } from './gate11Validation'
import { runAutoModeLedgerNegativeControls } from './negativeControls'
import type { LedgerGateValidationResult } from './types'

export async function runAutoModeLedgerValidation(): Promise<LedgerGateValidationResult[]> {
  const gate11 = await runGate11DurableReplayValidation()
  const negatives = await runAutoModeLedgerNegativeControls()
  const featureReadiness = validateLiveFeatureRegistry()
  const phase46k = runAppleReminderBridgeValidation()

  return [
    gate('gate_11_durable_replay', 'Durable replay validation passes.', allPass(gate11), gate11.map(result => `${result.caseId}:${result.result}`)),
    gate('ledger_negative_controls', 'Ledger negative controls pass.', allPass(negatives), negatives.map(result => `${result.caseId}:${result.result}`)),
    gate('live_feature_registry', 'Future live features are registered but disabled.', featureReadiness.ready ? 'PASS' : 'FAIL', featureReadiness.violations),
    gate('phase_46k_regression', '46K bridge validation remains stable.', phase46k.every(result => result.result === 'PASS') ? 'PASS' : 'FAIL', phase46k.map(result => `${result.gateId}:${result.result}`)),
  ]
}

function gate(
  gateId: string,
  description: string,
  result: 'PASS' | 'FAIL',
  notes: string[]
): LedgerGateValidationResult {
  return { gateId, description, result, notes }
}

function allPass(results: { result: 'PASS' | 'FAIL' }[]): 'PASS' | 'FAIL' {
  return results.every(result => result.result === 'PASS') ? 'PASS' : 'FAIL'
}
