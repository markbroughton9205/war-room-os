/**
 * Disconfirmation pass validation: bounded hypothesis selection, probe-result interpretation, and the direct
 * dropped-import check, then mutation checks.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as disconfirmation from './foundryDisconfirmation'
import { runMutation, type Mutation } from './foundryMutationHarness'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }
const ROOT = resolveRepoRoot()

type Module = typeof disconfirmation

function scenarios(module: Module): string[] {
  const failed: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failed.push(name) }

  const noSignal = module.selectDisconfirmationProbes({ criteria: ['Show the page title from settings'], touchedFiles: ['app/title.py'], primaryFiles: ['app/title.py'], installedRuntimeAvailable: false, handlesUntrustedInput: false })
  expect('no_applicable_signal_selects_nothing', noSignal.length === 0)

  const restartAsked = module.selectDisconfirmationProbes({ criteria: ['The change must survive a restart'], touchedFiles: ['a.py'], primaryFiles: ['a.py'], installedRuntimeAvailable: false, handlesUntrustedInput: false })
  expect('restart_wording_selects_the_restart_hypothesis', restartAsked.length === 1 && restartAsked[0].hypothesisId === 'RESTART_PERSISTENCE')

  const everythingApplies = module.selectDisconfirmationProbes({ criteria: ['Must survive a restart and reopening the project restores it'], touchedFiles: ['a.py'], primaryFiles: ['a.py'], installedRuntimeAvailable: true, handlesUntrustedInput: true })
  expect('selection_is_bounded_even_when_everything_applies', everythingApplies.length === module.MAX_PROBES)

  const failedProbe = module.interpretProbeResult({ hypothesisId: 'RESTART_PERSISTENCE', question: 'q', targetFiles: ['a.py'] }, { ran: true, passed: false, detail: 'state was lost after restart' })
  expect('a_failed_probe_becomes_a_blocking_directly_proven_finding', failedProbe !== null && failedProbe.severity === 'BLOCKING' && failedProbe.confidenceClass === 'DIRECTLY_PROVEN')

  const passedProbe = module.interpretProbeResult({ hypothesisId: 'RESTART_PERSISTENCE', question: 'q', targetFiles: ['a.py'] }, { ran: true, passed: true, detail: 'state survived' })
  expect('a_passed_probe_produces_no_finding', passedProbe === null)

  const unrunProbe = module.interpretProbeResult({ hypothesisId: 'INSTALLED_RUNTIME_MISMATCH', question: 'q', targetFiles: ['a.py'] }, { ran: false, reason: 'no installed runtime available' })
  expect('an_unrun_probe_is_unsupported_not_a_pass', unrunProbe !== null && unrunProbe.confidenceClass === 'UNSUPPORTED' && unrunProbe.actionability === 'NONE')

  const before = "import os\nfrom .helper import used_symbol\n\ndef f():\n    return used_symbol()\n"
  const afterDropped = "import os\n\ndef f():\n    return used_symbol()\n"
  const dropped = module.droppedImportFinding('a.py', before, afterDropped)
  expect('a_still_used_symbol_whose_import_was_dropped_is_flagged', dropped !== null && dropped.severity === 'BLOCKING')

  const afterRemovedCleanly = "import os\n\ndef f():\n    return os.getcwd()\n"
  const cleanRemoval = module.droppedImportFinding('a.py', before, afterRemovedCleanly)
  expect('an_import_removed_along_with_its_only_use_is_not_flagged', cleanRemoval === null)

  return failed
}

async function main() {
  const failedReal = scenarios(disconfirmation)
  const names = ['no_applicable_signal_selects_nothing', 'restart_wording_selects_the_restart_hypothesis', 'selection_is_bounded_even_when_everything_applies', 'a_failed_probe_becomes_a_blocking_directly_proven_finding', 'a_passed_probe_produces_no_finding', 'an_unrun_probe_is_unsupported_not_a_pass', 'a_still_used_symbol_whose_import_was_dropped_is_flagged', 'an_import_removed_along_with_its_only_use_is_not_flagged']
  for (const name of names) check(`S_${name}`, !failedReal.includes(name))

  const src = readFileSync(path.join(ROOT, 'lib/native-builder/foundryDisconfirmation.ts'), 'utf8')
  check('W_the_module_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(src), '')
  check('W_selection_is_bounded', /MAX_PROBES/.test(src) && /\.slice\(0, MAX_PROBES\)/.test(src), '')

  const file = path.join(ROOT, 'lib/native-builder/foundryDisconfirmation.ts')
  const mutations: Mutation[] = [
    { name: 'unrun_probe_treated_as_a_pass', from: "if (!outcome.ran) {", to: 'if (false as boolean) {' },
    { name: 'failed_probe_no_longer_reported', from: 'if (outcome.passed) return null', to: 'return null' },
    { name: 'selection_bound_removed', from: 'return candidates.slice(0, MAX_PROBES)', to: 'return candidates' },
    { name: 'dropped_import_never_detected', from: 'if (!dropped.length) return null', to: 'return null' },
  ]
  for (const mutation of mutations) {
    const outcome = await runMutation<Module>(file, mutation, scenarios)
    check(`M_${mutation.name}_is_caught`, outcome.caught, outcome.failed.slice(0, 2).join(' | '))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`DISCONFIRMATION_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
