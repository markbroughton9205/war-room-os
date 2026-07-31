import { resolveOperatorDiagnosticVisibility } from './operatorDiagnosticsUi'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const DEGRADED_CONTENT = 'Provider response incomplete; fallback summary used'
const NORMAL_CONTENT = 'Here is a real, complete answer to the decree with no diagnostic language at all.'

export function runOperatorDiagnosticsUiValidation(): CaseResult[] {
  // 1. A current-operation degraded response is visible, even when old diagnostics are muted.
  const currentDegradedMuted = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: true,
  })

  // Also verify via the `degraded` flag path (not just pattern-matched text).
  const currentDegradedFlagMuted = resolveOperatorDiagnosticVisibility({
    content: 'This looks like a normal sentence but was flagged degraded upstream.',
    messageType: 'response',
    degraded: true,
    operatorDiagnosticsMuted: true,
    isCurrentOperation: true,
  })

  // 2. An older diagnostic response remains hidden when old diagnostics are muted.
  const olderDegradedMuted = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: false,
  })

  // 3. A normal provider response remains visible regardless of operation recency or muting.
  const normalCurrent = resolveOperatorDiagnosticVisibility({
    content: NORMAL_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: true,
  })
  const normalOlder = resolveOperatorDiagnosticVisibility({
    content: NORMAL_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: false,
  })

  // 4. Toggling "Show old diagnostics" still behaves correctly for OLDER messages...
  const olderDegradedUnmuted = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: false,
    isCurrentOperation: false,
  })
  // ...while the toggle has no effect on CURRENT-operation visibility (never hidden either way).
  const currentDegradedUnmuted = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: false,
    isCurrentOperation: true,
  })

  // Pre-existing bypass behavior (diagnosticsOpen / councilPassthroughMode) must be unaffected.
  const diagnosticsOpenBypass = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: false,
    diagnosticsOpen: true,
  })
  const passthroughBypass = resolveOperatorDiagnosticVisibility({
    content: DEGRADED_CONTENT,
    messageType: 'response',
    operatorDiagnosticsMuted: true,
    isCurrentOperation: false,
    councilPassthroughMode: true,
  })

  return [
    check(
      'diag_01_current_operation_degraded_text_is_visible_when_muted',
      currentDegradedMuted === 'degraded_notice',
      currentDegradedMuted,
    ),
    check(
      'diag_02_current_operation_degraded_flag_is_visible_when_muted',
      currentDegradedFlagMuted === 'degraded_notice',
      currentDegradedFlagMuted,
    ),
    check(
      'diag_03_older_diagnostic_hidden_when_muted',
      olderDegradedMuted === 'hidden',
      olderDegradedMuted,
    ),
    check(
      'diag_04_normal_current_response_visible',
      normalCurrent === 'normal',
      normalCurrent,
    ),
    check(
      'diag_05_normal_older_response_visible',
      normalOlder === 'normal',
      normalOlder,
    ),
    check(
      'diag_06_older_diagnostic_visible_when_toggle_shows_old_diagnostics',
      olderDegradedUnmuted === 'degraded_notice',
      olderDegradedUnmuted,
    ),
    check(
      'diag_07_current_operation_diagnostic_visible_regardless_of_toggle',
      currentDegradedUnmuted === 'degraded_notice',
      currentDegradedUnmuted,
    ),
    check(
      'diag_08_current_operation_never_hidden_across_both_toggle_states',
      currentDegradedMuted !== 'hidden' && currentDegradedUnmuted !== 'hidden',
      `${currentDegradedMuted} / ${currentDegradedUnmuted}`,
    ),
    check(
      'diag_09_diagnosticsOpen_bypasses_classification_entirely',
      diagnosticsOpenBypass === 'normal',
      diagnosticsOpenBypass,
    ),
    check(
      'diag_10_councilPassthroughMode_bypasses_classification_entirely',
      passthroughBypass === 'normal',
      passthroughBypass,
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOperatorDiagnosticsUiValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Operator diagnostics UI validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
