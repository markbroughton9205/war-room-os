/**
 * Tokenizer environment truth (Part 6). Probes the ACTUAL local environment — installs nothing,
 * never searches for or executes arbitrary Python modules, only ever imports the two fixed
 * approved libraries by exact name. Every field is real-detected-or-null/unknown, matching the
 * honesty discipline already established in hardwareProbe.ts.
 */
import { access, constants as fsConstants, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { probeFreeDiskBytes, resolvePythonExecutable } from './hardwareProbe'
import type { TokenizerEnvironmentReport, TokenizerLibraryName, TokenizerLibraryProbeResult } from './types'

const execFileAsync = promisify(execFile)
const PROBE_TIMEOUT_MS = 5000
const LIBRARY_PROBE_TIMEOUT_MS = 5000
const APPROVED_LIBRARIES: readonly TokenizerLibraryName[] = ['tokenizers', 'sentencepiece']

/**
 * Runs `pythonExe -c <code>` with shell:false. Deliberately does NOT reuse hardwareProbe.ts's
 * tryExec for `-c` invocations: that pre-existing helper's `shell: process.platform === 'win32'`
 * mishandles argv quoting for arguments containing spaces on Windows (verified directly — it
 * silently returns null for `-c "import sys; print(sys.executable)"`), which would make this
 * probe's absolute-path resolution fail closed even when Python is fully installed and correct.
 * This is an in-scope fix to this module's own probing, not a modification of hardwareProbe.ts. */
async function runPythonProbe(pythonExe: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(pythonExe, args, { windowsHide: true, timeout: PROBE_TIMEOUT_MS, shell: false })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Hardcoded, explicitly-labeled Python-3.14-support table. No network/PyPI access is permitted
 * from this probe, so this can never be looked up live — only ever a small authored table,
 * defaulting to 'unknown' for anything not in it. Populated empirically below: if the library
 * actually imports successfully under the detected Python 3.14 interpreter, that import itself IS
 * empirical proof of support (recorded as 'supported', not looked up from this table).
 */
const KNOWN_PYTHON_314_INCOMPATIBLE: ReadonlySet<TokenizerLibraryName> = new Set()

/** Takes the exact resolved executable path (never a bare command name relying on shell/PATH
 * resolution) — see the Commander fix-packet requirement that no Phase 2A subprocess call may set
 * shell:true. execFile resolves a genuine .exe directly via CreateProcess on Windows; no shell is
 * needed for that, only for shell built-ins/batch files, neither of which applies here. */
async function probeLibrary(exactPythonExecutable: string, library: TokenizerLibraryName, pythonVersion: string | null): Promise<TokenizerLibraryProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      exactPythonExecutable,
      ['-c', `import ${library}; print(getattr(${library}, "__version__", "unknown"))`],
      { windowsHide: true, timeout: LIBRARY_PROBE_TIMEOUT_MS, shell: false },
    )
    const version = stdout.trim() || 'unknown'
    const isPy314 = Boolean(pythonVersion?.includes('3.14'))
    const python314Support: TokenizerLibraryProbeResult['python314Support'] =
      KNOWN_PYTHON_314_INCOMPATIBLE.has(library)
        ? 'unsupported'
        : isPy314
          ? 'supported' // it just imported successfully under this exact 3.14 interpreter — empirical, not guessed
          : 'unknown'
    return { library, importable: true, version, python314Support }
  } catch {
    return { library, importable: false, version: null, python314Support: 'unknown' }
  }
}

async function checkWritableDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true })
    const probeFile = path.join(dir, `.write-probe-${randomUUID()}.tmp`)
    await writeFile(probeFile, 'ok', 'utf8')
    await access(probeFile, fsConstants.W_OK)
    await rm(probeFile, { force: true })
    return true
  } catch {
    return false
  }
}

function overallStatus(pythonAvailable: boolean, libraries: TokenizerLibraryProbeResult[], writableOutputDir: boolean | null): TokenizerEnvironmentReport['status'] {
  if (!pythonAvailable) return 'probe_failed'
  const anyImportable = libraries.some(lib => lib.importable)
  if (!anyImportable) return 'missing_dependency'
  const anyKnownUnsupported = libraries.some(lib => lib.importable && lib.python314Support === 'unsupported')
  if (anyKnownUnsupported || writableOutputDir === false) return 'incompatible'
  return 'compatible'
}

export async function probeTokenizerEnvironment(): Promise<TokenizerEnvironmentReport> {
  const generatedAt = new Date().toISOString()
  const pythonExe = await resolvePythonExecutable()

  if (!pythonExe) {
    return {
      generatedAt,
      pythonExecutablePath: null,
      pythonVersion: null,
      architecture: null,
      libraries: APPROVED_LIBRARIES.map(library => ({ library, importable: false, version: null, python314Support: 'unknown' })),
      cpuCount: os.cpus().length || null,
      availableRamBytes: os.freemem() || null,
      freeDiskBytes: await probeFreeDiskBytes(),
      writableOutputDir: null,
      proposedExecutablePath: null,
      proposedArgv: null,
      environmentVariablesPassed: [],
      networkIsolationEnforceable: false,
      networkIsolationNote: 'No Python executable detected — nothing to isolate.',
      status: 'probe_failed',
      honestyNote: 'No python/python3 executable could be located on this machine. Every field above is real-detected-or-null, never fabricated.',
    }
  }

  const [versionOut, archOut, absPathOut] = await Promise.all([
    runPythonProbe(pythonExe, ['--version']),
    runPythonProbe(pythonExe, ['-c', 'import platform; print(platform.machine())']),
    runPythonProbe(pythonExe, ['-c', 'import sys; print(sys.executable)']),
  ])

  // Fail closed: if the exact absolute executable path can't be resolved, do not silently fall
  // back to invoking the bare command name (which would rely on the OS/shell's own PATH search at
  // every later call site, exactly what this fix packet requires eliminating). The whole probe
  // reports probe_failed instead, and no plan can be created from it (createTokenizerPlan already
  // requires environment.pythonExecutablePath to be non-null).
  if (!absPathOut) {
    return {
      generatedAt,
      pythonExecutablePath: null,
      pythonVersion: versionOut,
      architecture: archOut,
      libraries: APPROVED_LIBRARIES.map(library => ({ library, importable: false, version: null, python314Support: 'unknown' })),
      cpuCount: os.cpus().length || null,
      availableRamBytes: os.freemem() || null,
      freeDiskBytes: await probeFreeDiskBytes(),
      writableOutputDir: null,
      proposedExecutablePath: null,
      proposedArgv: null,
      environmentVariablesPassed: [],
      networkIsolationEnforceable: false,
      networkIsolationNote: 'No exact Python executable path could be resolved — nothing to isolate.',
      status: 'probe_failed',
      honestyNote: 'A python/python3 command was found on PATH, but its exact absolute executable path (via sys.executable) could not be resolved. Rather than fall back to invoking the bare command name (which would require shell/PATH resolution at every later call), this probe fails closed.',
    }
  }

  const libraries = await Promise.all(APPROVED_LIBRARIES.map(lib => probeLibrary(absPathOut, lib, versionOut)))

  const outputDir = path.join(resolveRepoRoot(), '.war-room', 'sovereign-model-lab', 'tokenizers', 'WRM-001')
  const writableOutputDir = await checkWritableDir(outputDir)

  const scriptPath = path.join(resolveRepoRoot(), 'scripts', 'sovereign-model-lab', 'train_wrm001_tokenizer.py')
  const proposedArgv = [
    scriptPath,
    '--corpus', '<pending: resolved at plan-creation time>',
    '--output-dir', '<pending: resolved at plan-creation time>',
    '--algorithm', 'bpe',
    '--vocab-size', '8192',
    '--minimum-frequency', '2',
    '--seed', '42',
    '--manifest-output', '<pending: resolved at plan-creation time>',
  ]

  // Fixed, minimal environment allowlist — never inherits API keys/secrets. PATH is required for
  // the interpreter to resolve its own standard library and DLLs; SystemRoot is required on
  // Windows for basic OS functionality.
  const environmentVariablesPassed = process.platform === 'win32'
    ? ['PATH', 'SystemRoot', 'TEMP', 'TMP']
    : ['PATH']

  return {
    generatedAt,
    pythonExecutablePath: absPathOut,
    pythonVersion: versionOut,
    architecture: archOut,
    libraries,
    cpuCount: os.cpus().length || null,
    availableRamBytes: os.freemem() || null,
    freeDiskBytes: await probeFreeDiskBytes(),
    writableOutputDir,
    proposedExecutablePath: absPathOut,
    proposedArgv,
    environmentVariablesPassed,
    networkIsolationEnforceable: false,
    networkIsolationNote: 'Node\'s child_process has no OS-level network sandbox on Windows without additional tooling (e.g. a job object / firewall rule). Compliance rests on the training script itself never importing a network client — verified statically by the validation suite, not enforced by process isolation at runtime.',
    status: overallStatus(true, libraries, writableOutputDir),
    honestyNote: 'Every field above is either a real detected value or null/"unknown" — never a fabricated guess. python314Support is only ever marked "supported" when the library actually imported successfully under a detected Python 3.14 interpreter; it is never looked up from a network source.',
  }
}
