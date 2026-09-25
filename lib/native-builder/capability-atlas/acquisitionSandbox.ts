/**
 * Isolated capability-evaluation sandbox under the Foundry data hierarchy.
 * Never the canonical repo, Terra, WRIM, Harbor Desk, or production installs.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { foundryDataHierarchy } from '../foundryPaths'
import { resolveRepoRoot } from '@/lib/repo/paths'

export const ACQUISITION_GOVERNANCE = {
  commit: false,
  push: false,
  deploy: false,
  terra: false,
  wrimTraining: false,
  productionEval: false,
  kernelModuleLoad: false,
  systemServiceInstall: false,
  downloadModelWeights: false,
  automaticPackageInstall: false,
  blocksCommanderProjects: false,
  isPermissionWhitelist: false,
} as const

const FORBIDDEN_NAME = /(?:^|\/)(?:terra|wrim|wr-corpus|wr-tokenizer|harbor-desk)(?:\/|$)/i
const FORBIDDEN_CMDS = /\b(insmod|rmmod|modprobe|dkms)\b/
const FORBIDDEN_SERVICE_INSTALL = /\/etc\/systemd\/|\/lib\/systemd\/system\/|\.config\/systemd\/user\//

export class AcquisitionSandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcquisitionSandboxError'
  }
}

export function capabilityEvaluationRoot(override?: string): string {
  const root = override && override.trim() ? override : path.join(foundryDataHierarchy().capabilityEvaluation)
  mkdirSync(root, { recursive: true })
  return root
}

export function wave1SandboxRoot(override?: string): string {
  const root = path.join(capabilityEvaluationRoot(override), 'wave1')
  mkdirSync(root, { recursive: true })
  return root
}

export function wave2SandboxRoot(override?: string): string {
  const root = path.join(capabilityEvaluationRoot(override), 'wave2')
  mkdirSync(root, { recursive: true })
  return root
}

export function nebulaSandboxRoot(override?: string): string {
  const root = path.join(capabilityEvaluationRoot(override), 'nebula-toolchain')
  mkdirSync(root, { recursive: true })
  return root
}

export function wave3SandboxRoot(override?: string): string {
  const root = path.join(capabilityEvaluationRoot(override), 'wave3')
  mkdirSync(root, { recursive: true })
  return root
}

export function wave4SandboxRoot(override?: string): string {
  const root = path.join(capabilityEvaluationRoot(override), 'wave4')
  mkdirSync(root, { recursive: true })
  return root
}

export function assertSandboxIsolation(target: string, sandboxRoot: string): string {
  const resolved = path.resolve(target)
  const root = path.resolve(sandboxRoot)
  const repo = path.resolve(resolveRepoRoot())
  if (resolved === repo || resolved.startsWith(`${repo}${path.sep}`)) {
    throw new AcquisitionSandboxError(`REFUSED_SANDBOX_ISOLATION: ${resolved} is inside the canonical repo`)
  }
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    throw new AcquisitionSandboxError(`REFUSED_SANDBOX_ISOLATION: ${resolved} is outside ${root}`)
  }
  if (FORBIDDEN_NAME.test(resolved)) {
    throw new AcquisitionSandboxError(`REFUSED_SANDBOX_ISOLATION: forbidden subsystem path ${resolved}`)
  }
  return resolved
}

export function writeSandboxFile(sandboxRoot: string, rel: string, contents: string): string {
  if (path.isAbsolute(rel)) throw new AcquisitionSandboxError('Sandbox writes must be relative')
  const dest = assertSandboxIsolation(path.join(sandboxRoot, rel), sandboxRoot)
  mkdirSync(path.dirname(dest), { recursive: true })
  writeFileSync(dest, contents, 'utf8')
  return dest
}

export type CommandResult = {
  command: string
  cwd: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runSandboxCommand(input: {
  sandboxRoot: string
  argv: string[]
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  allowKernelLoad?: false
}): CommandResult {
  const cwd = assertSandboxIsolation(input.cwd ?? input.sandboxRoot, input.sandboxRoot)
  const rendered = input.argv.join(' ')
  if (FORBIDDEN_CMDS.test(rendered)) {
    throw new AcquisitionSandboxError(`REFUSED_KERNEL_LOAD: ${rendered}`)
  }
  if (FORBIDDEN_SERVICE_INSTALL.test(rendered) && /(?:cp|install|ln|systemctl enable)/.test(rendered)) {
    throw new AcquisitionSandboxError(`REFUSED_SYSTEM_SERVICE_INSTALL: ${rendered}`)
  }
  const result = spawnSync(input.argv[0]!, input.argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: input.timeoutMs ?? 20_000,
    env: { ...process.env, ...(input.env ?? {}), PWD: cwd, WRIM_TRAINING: '0' },
  })
  return {
    command: rendered,
    cwd,
    exitCode: result.status,
    stdout: (result.stdout || '').slice(0, 8_000),
    stderr: (result.stderr || result.error?.message || '').slice(0, 8_000),
    timedOut: Boolean(result.error && /ETIMEDOUT|timed out/i.test(String(result.error))),
  }
}

export function which(bin: string): string | null {
  const extra = [
    path.join(process.env.HOME || '', '.cargo', 'bin'),
    '/usr/local/cuda/bin',
    '/usr/local/cuda-13.1/bin',
    path.join(process.env.HOME || '', '.local', 'bin'),
    path.join(process.env.HOME || '', '.local', 'share', 'war-room-os', 'data', 'foundry', 'toolchains', 'go', 'bin'),
    '/usr/lib/postgresql/18/bin',
  ]
  const extraPath = extra.filter(dir => existsSync(dir)).join(':')
  const result = spawnSync('bash', ['-lc', `PATH="${extraPath}:$PATH" command -v ${bin} || true`], { encoding: 'utf8', timeout: 5_000 })
  const value = (result.stdout || '').trim().split('\n')[0] || ''
  return value && existsSync(value) ? value : null
}

export type AcquisitionEnvironment = {
  gcc: string | null
  cc: string | null
  clang: string | null
  make: string | null
  nvcc: string | null
  nvidiaSmi: string | null
  python3: string | null
  systemdAnalyze: string | null
  systemctl: string | null
  rustc: string | null
  cargo: string | null
  psql: string | null
  postgres: string | null
  node: string | null
  npm: string | null
  opt: string | null
  llc: string | null
  curl: string | null
  curlHttp3: boolean
  kernelBuildDir: string | null
  kernelRelease: string
  automaticPackageInstall: boolean
  gpu: {
    name: string | null
    driver: string | null
    cudaReported: string | null
    memoryTotalMiB: number | null
    memoryUsedMiB: number | null
    memoryFreeMiB: number | null
    queryError: string | null
  }
  torch: { present: boolean; cuda: boolean; version: string | null; error: string | null }
}

export function probeAcquisitionEnvironment(sandboxRoot: string): AcquisitionEnvironment {
  const gcc = which('gcc')
  const cc = which('cc')
  const clang = which('clang')
  const make = which('make')
  const nvcc = which('nvcc')
  const nvidiaSmi = which('nvidia-smi')
  const python3 = which('python3')
  const systemdAnalyze = which('systemd-analyze')
  const systemctl = which('systemctl')
  const rustc = which('rustc')
  const cargo = which('cargo')
  const psql = which('psql')
  const postgres = which('postgres')
  const node = which('node')
  const npm = which('npm')
  const opt = which('opt')
  const llc = which('llc')
  const curl = which('curl')
  const release = spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout?.trim() || ''
  const kernelBuildDir = release && existsSync(`/lib/modules/${release}/build`) ? `/lib/modules/${release}/build` : null
  const gpu = {
    name: null as string | null,
    driver: null as string | null,
    cudaReported: null as string | null,
    memoryTotalMiB: null as number | null,
    memoryUsedMiB: null as number | null,
    memoryFreeMiB: null as number | null,
    queryError: null as string | null,
  }
  if (nvidiaSmi) {
    const q = runSandboxCommand({
      sandboxRoot,
      argv: [nvidiaSmi, '--query-gpu=name,driver_version,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
      timeoutMs: 10_000,
    })
    const line = q.stdout.trim().split('\n')[0] ?? ''
    if (q.exitCode === 0 && line) {
      const parts = line.split(',').map(item => item.trim())
      gpu.name = parts[0] ?? null
      gpu.driver = parts[1] ?? null
      gpu.memoryTotalMiB = Number(parts[2]) || null
      gpu.memoryUsedMiB = Number(parts[3]) || null
      gpu.memoryFreeMiB = Number(parts[4]) || null
    } else {
      gpu.queryError = (q.stderr || q.stdout || `exit ${q.exitCode}`).slice(0, 400)
    }
    const ver = runSandboxCommand({ sandboxRoot, argv: [nvidiaSmi], timeoutMs: 10_000 })
    const cuda = ver.stdout.match(/CUDA Version:\s*([0-9.]+)/)
    if (cuda) gpu.cudaReported = cuda[1] ?? null
  } else {
    gpu.queryError = 'nvidia-smi not found'
  }
  let torch: AcquisitionEnvironment['torch'] = { present: false, cuda: false, version: null, error: null }
  if (python3) {
    const t = runSandboxCommand({
      sandboxRoot,
      argv: [python3, '-c', 'import torch; print(torch.__version__); print(int(torch.cuda.is_available()))'],
      timeoutMs: 15_000,
    })
    if (t.exitCode === 0) {
      const [version, cudaFlag] = t.stdout.trim().split('\n')
      torch = { present: true, cuda: cudaFlag === '1', version: version ?? null, error: null }
    } else {
      torch = { present: false, cuda: false, version: null, error: (t.stderr || t.stdout).slice(0, 400) }
    }
  }
  let curlHttp3 = false
  if (curl) {
    const ver = spawnSync(curl, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    curlHttp3 = /HTTP3|nghttp3|quiche|msh3/i.test(`${ver.stdout || ''} ${ver.stderr || ''}`)
  }
  return {
    gcc, cc, clang, make, nvcc, nvidiaSmi, python3, systemdAnalyze, systemctl,
    rustc, cargo, psql, postgres, node, npm, opt, llc, curl, curlHttp3,
    kernelBuildDir, kernelRelease: release, automaticPackageInstall: false, gpu, torch,
  }
}

export function assertNoAutomaticPackageInstall(env: AcquisitionEnvironment): void {
  if (env.automaticPackageInstall) {
    throw new AcquisitionSandboxError('REFUSED_AUTOMATIC_PACKAGE_INSTALL')
  }
  if (ACQUISITION_GOVERNANCE.automaticPackageInstall) {
    throw new AcquisitionSandboxError('REFUSED_AUTOMATIC_PACKAGE_INSTALL')
  }
}

export function cCompiler(env: AcquisitionEnvironment): string | null {
  return env.gcc || env.cc || env.clang
}

export function assertNotFakeCudaPass(env: AcquisitionEnvironment, outcome: 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_RUN'): void {
  if (outcome !== 'PASS') return
  if (env.nvcc || env.torch.cuda) return
  throw new AcquisitionSandboxError('REFUSED_FAKE_CUDA_PASS: CUDA PASS requires nvcc or a CUDA-capable installed framework')
}
