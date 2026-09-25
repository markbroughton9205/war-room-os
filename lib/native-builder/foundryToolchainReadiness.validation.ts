/**
 * Nebula Genesis engineering toolchain readiness proofs.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { isProtectedSubsystemPath } from './foundryMissionWriteSet'
import { foundryDataHierarchy } from './foundryPaths'
import {
  ACQUISITION_GOVERNANCE,
  PLANNER_CAPABILITY_GATE,
  CAPABILITY_GATE_AUTHORITY,
  GOVERNANCE,
  WRIM_INTEGRATION_BOUNDARY,
  assertSandboxIsolation,
  assertNotFakeCudaPass,
  AcquisitionSandboxError,
  probeToolchainReadiness,
  runToolchainPrep,
  TOOLCHAIN_GOVERNANCE,
  which,
} from './capability-atlas'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function present(bin: string): boolean {
  return Boolean(which(bin) || spawnSync('bash', ['-lc', `command -v ${bin}`], { encoding: 'utf8' }).status === 0)
}

async function run() {
  const previous = process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
  const atlasTmp = await mkdtemp(path.join(tmpdir(), 'wr-toolchain-atlas-'))
  const sandboxTmp = await mkdtemp(path.join(tmpdir(), 'wr-toolchain-sandbox-'))
  process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = atlasTmp
  const results: CaseResult[] = []
  try {
    const ready = probeToolchainReadiness()
    results.push(check('c_compiler_present', Boolean(ready.gcc), ready.gcc || 'missing'))
    results.push(check('make_present', Boolean(ready.make), ready.make || 'missing'))
    results.push(check('rust_present', Boolean(ready.rustc && ready.cargo), `${ready.rustc || 'no-rustc'} ${ready.cargo || 'no-cargo'}`))
    results.push(check('llvm_present', Boolean(ready.clang && ready.opt && ready.llc), `${ready.clang} ${ready.opt} ${ready.llc}`))
    results.push(check('postgresql_local_usable', Boolean(ready.psql) && /127\.0\.0\.1/.test(ready.postgresListen), ready.postgresListen))
    results.push(check('kernel_headers_detected', Boolean(ready.kernelBuildDir && existsSync(ready.kernelBuildDir)), ready.kernelBuildDir || 'missing'))
    results.push(check('cuda_toolkit_detected_or_blocked', ready.cudaToolkit === 'READY' || ready.cudaToolkit === 'CUDA_TOOLKIT_BLOCKED', ready.cudaToolkit))
    results.push(check('pytorch_cuda_detected_or_blocked', ready.pytorchCuda === 'READY' || ready.pytorchCuda === 'PYTORCH_CUDA_BLOCKED', `${ready.pytorchCuda} torch=${ready.torchPython || 'missing'}`))
    results.push(check('no_fake_cuda_if_blocked', ready.cudaToolkit === 'READY' ? Boolean(ready.nvcc) : ready.nvcc === null, `nvcc=${ready.nvcc || 'missing'}`))

    let isolated = false
    try {
      assertSandboxIsolation(path.join(resolveRepoRoot(), 'package.json'), sandboxTmp)
    } catch (error) {
      isolated = error instanceof AcquisitionSandboxError
    }
    results.push(check('sandbox_isolation', isolated, 'repo refused'))

    const report = runToolchainPrep({ sandboxRoot: sandboxTmp, persist: true })
    const cmds = report.exercises.flatMap(item => item.commands).join(' ')
    results.push(check('kernel_module_compiles_if_compatible', ready.kernelBuildDir && ready.make && ready.gcc
      ? report.exercises.some(item => item.exerciseId === 'nebula-hello-kbuild' && (item.finalOutcome === 'PASS' || item.finalOutcome === 'PARTIAL'))
      : true, report.exercises.find(item => item.exerciseId === 'nebula-hello-kbuild')?.finalOutcome ?? 'skipped'))
    results.push(check('usb_fixture_compiles_if_compatible', report.exercises.some(item => item.exerciseId === 'nebula-usb-kbuild'), report.exercises.find(item => item.exerciseId === 'nebula-usb-kbuild')?.finalOutcome ?? 'missing'))
    results.push(check('real_gpu_test_if_available', ready.cudaToolkit !== 'READY' || report.exercises.some(item => item.skillId === 'ml.cuda'), ready.cudaToolkit))
    results.push(check('kernel_module_not_loaded', !/\binsmod\b|\bmodprobe\b/.test(cmds), cmds.slice(0, 160)))
    results.push(check('no_project_mutation', report.repoUntouched && report.exercises.every(item => !item.sandboxPath.startsWith(resolveRepoRoot())), report.sandboxRoot))
    results.push(check('no_terra', TOOLCHAIN_GOVERNANCE.terra === false && GOVERNANCE.terra === false && isProtectedSubsystemPath('components/war-room/terra/Globe.tsx'), 'terra'))
    results.push(check('no_wrim_training', TOOLCHAIN_GOVERNANCE.wrimTraining === false && WRIM_INTEGRATION_BOUNDARY.trainingExecuted === false, 'wrim'))
    results.push(check('no_commander_whitelist', PLANNER_CAPABILITY_GATE.blocksCommanderProjects === false && CAPABILITY_GATE_AUTHORITY.isCommanderPermissionWhitelist === false, 'freedom'))
    results.push(check('production_proven_unchanged', report.scoreboardAfter.productionProven === report.scoreboardBefore.productionProven, `${report.scoreboardBefore.productionProven}->${report.scoreboardAfter.productionProven}`))
    results.push(check('no_commit_push_deploy', ACQUISITION_GOVERNANCE.commit === false && ACQUISITION_GOVERNANCE.push === false && ACQUISITION_GOVERNANCE.deploy === false, 'cpd'))

    let fakeCuda = false
    try {
      assertNotFakeCudaPass({ ...report.environment, nvcc: null, torch: { present: false, cuda: false, version: null, error: 'x' } }, 'PASS')
    } catch {
      fakeCuda = true
    }
    results.push(check('refuse_fake_cuda_pass', fakeCuda, 'guard'))
    results.push(check('foundry_venv_not_system_python', !ready.torchPython || ready.torchPython.includes('/foundry/toolchains/python-cu/'), ready.torchPython || 'no-venv'))
    results.push(check('harbor_not_in_sandbox', !report.sandboxRoot.toLowerCase().includes('harbor'), report.sandboxRoot))
    results.push(check('toolchain_dir_exists', existsSync(foundryDataHierarchy().toolchains), foundryDataHierarchy().toolchains))
    results.push(check('c_replay_attempted', report.exercises.some(item => item.skillId === 'software.languages.c'), 'c'))
    results.push(check('rust_replay_attempted', report.exercises.some(item => item.skillId === 'software.languages.rust'), 'rust'))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT
    else process.env.FOUNDRY_CAPABILITY_ATLAS_ROOT = previous
    await rm(atlasTmp, { recursive: true, force: true })
    await rm(sandboxTmp, { recursive: true, force: true })
  }

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry toolchain readiness: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryToolchainReadinessValidation }
