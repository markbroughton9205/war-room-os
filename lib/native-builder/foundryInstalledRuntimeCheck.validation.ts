/**
 * Installed-runtime-mismatch probe validation: a real fake launcher + install tree (proving the parsing and the
 * comparison behaviourally), then a check against whatever desktop install is genuinely active on this machine.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import os from 'node:os'
import { activeInstallDir, installedRuntimeAvailable, checkInstalledRuntimeMatches } from './foundryInstalledRuntimeCheck'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }
const ROOT = resolveRepoRoot()

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'wr-installed-runtime-'))
  const installDir = path.join(scratch, 'opt', 'war-room-os-0.1.0-test-fake', 'opt', 'War-Room-OS')
  mkdirSync(path.join(installDir, 'resources/runtime/ui/lib/native-builder'), { recursive: true })
  const launcher = path.join(scratch, 'launcher')
  writeFileSync(launcher, `#!/bin/bash\nexec "${installDir}/war-room-os" --ozone-platform=x11\n`, 'utf8')

  check('activeInstallDir_parses_a_real_launcher_line', activeInstallDir(launcher) === installDir, activeInstallDir(launcher) ?? 'null')
  check('installedRuntimeAvailable_is_true_with_a_real_launcher', installedRuntimeAvailable(launcher) === true, '')

  const noLauncher = path.join(scratch, 'no-such-launcher')
  check('activeInstallDir_is_null_with_no_launcher_file', activeInstallDir(noLauncher) === null, '')
  check('installedRuntimeAvailable_is_false_with_no_launcher_file', installedRuntimeAvailable(noLauncher) === false, '')

  writeFileSync(path.join(scratch, 'garbage-launcher'), '#!/bin/bash\necho not a real launcher\n', 'utf8')
  check('activeInstallDir_is_null_when_the_launcher_does_not_match_the_expected_shape', activeInstallDir(path.join(scratch, 'garbage-launcher')) === null, '')

  const file = 'lib/native-builder/foundryEngineeringRuntime.ts'
  const identicalText = 'export const same = 1\n'
  writeFileSync(path.join(installDir, 'resources/runtime/ui', file), identicalText, 'utf8')
  const match = checkInstalledRuntimeMatches(file, identicalText, launcher)
  check('an_identical_file_reports_ran_and_passed', match.ran === true && match.ran === true && match.passed === true, JSON.stringify(match))

  const differentText = 'export const same = 2 // this repo has moved on\n'
  const mismatch = checkInstalledRuntimeMatches(file, differentText, launcher)
  check('a_file_that_moved_on_from_the_install_is_caught', mismatch.ran === true && mismatch.ran === true && mismatch.passed === false, JSON.stringify(mismatch))

  const missingFile = checkInstalledRuntimeMatches('this/file/is/not/in/the/install.ts', 'irrelevant', launcher)
  check('a_file_the_install_never_had_is_reported_unrun_not_a_pass', missingFile.ran === false, JSON.stringify(missingFile))

  const noInstallAtAll = checkInstalledRuntimeMatches(file, identicalText, noLauncher)
  check('with_no_active_install_at_all_the_probe_is_unrun_not_a_pass', noInstallAtAll.ran === false, JSON.stringify(noInstallAtAll))

  rmSync(scratch, { recursive: true, force: true })

  // The genuine machine state, whatever it is right now — proves the real (non-overridden) default path resolves consistently.
  const realLauncher = path.join(os.homedir(), '.local/bin/war-room-os-user')
  const realLauncherPresent = existsSync(realLauncher)
  check('the_real_default_launcher_path_agrees_with_installedRuntimeAvailable', !realLauncherPresent || installedRuntimeAvailable() === true, activeInstallDir() ?? 'none')
  if (activeInstallDir()) {
    const realFile = 'lib/native-builder/foundryEngineeringRuntime.ts'
    const realOutcome = checkInstalledRuntimeMatches(realFile, readFileSync(path.join(ROOT, realFile), 'utf8'))
    check('the_real_active_install_probe_returns_a_well_formed_outcome', realOutcome.ran === true || realOutcome.ran === false, JSON.stringify(realOutcome))
  }

  const failed = results.filter(r => !r.pass)
  console.log(`INSTALLED_RUNTIME_CHECK_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
void main()
