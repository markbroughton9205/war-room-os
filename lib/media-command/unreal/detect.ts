/**
 * Local Unreal probe. Reads the machine. Does not install, download, or launch.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type HvsUnrealMachineTrace = {
  installed: 'YES' | 'NO' | 'PARTIAL'
  version: string | null
  installPath: string | null
  editorPath: string | null
  projects: string[]
  epicLauncher: 'NOT_FOUND'
  sourceTree: 'NOT_FOUND'
  metahumanAssets: 'FOUND' | 'NOT_FOUND'
  downloadedThisProcess: false
  error: string | null
  searched: string[]
  gpu: {
    name: string | null
    driver: string | null
    memoryMiB: number | null
    nvidiaSmi: 'OK' | 'UNAVAILABLE'
  }
  os: {
    prettyName: string | null
    kernel: string
    glibc: string | null
    clang: string | null
    vulkanNvidiaIcd: boolean
    vulkaninfo: boolean
  }
  linux: {
    machineProven: string[]
    official: string[]
    officialDoc: 'Epic Games — Linux Development Requirements for Unreal Engine (5.8 documentation)'
  }
}

const EDITOR_NAMES = ['UnrealEditor', 'UnrealEditor-Cmd']

function which(command: string): string | null {
  try {
    const found = execFileSync('which', [command], { encoding: 'utf8', timeout: 2000 }).trim()
    return found || null
  } catch {
    return null
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function versionNear(editorPath: string): string | null {
  const buildVersion = path.join(path.dirname(editorPath), '..', '..', 'Build', 'Build.version')
  const raw = readText(buildVersion)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { MajorVersion?: number; MinorVersion?: number; PatchVersion?: number }
    if (typeof parsed.MajorVersion !== 'number') return null
    return [parsed.MajorVersion, parsed.MinorVersion ?? 0, parsed.PatchVersion ?? 0].join('.')
  } catch {
    return null
  }
}

function listUprojects(dir: string, depth: number, out: string[]) {
  if (depth < 0 || out.length >= 20 || !existsSync(dir)) return
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'snap') continue
    const full = path.join(dir, name)
    let info
    try {
      info = statSync(full)
    } catch {
      continue
    }
    if (info.isFile() && name.endsWith('.uproject')) out.push(full)
    if (info.isDirectory()) listUprojects(full, depth - 1, out)
  }
}

function gpu(): HvsUnrealMachineTrace['gpu'] {
  try {
    const line = execFileSync('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim().split('\n')[0] ?? ''
    const [name, driver, memory] = line.split(',').map(part => part.trim())
    const memoryMiB = Number.parseInt(memory ?? '', 10)
    return {
      name: name || null,
      driver: driver || null,
      memoryMiB: Number.isFinite(memoryMiB) ? memoryMiB : null,
      nvidiaSmi: 'OK',
    }
  } catch {
    return { name: null, driver: null, memoryMiB: null, nvidiaSmi: 'UNAVAILABLE' }
  }
}

function prettyOs(): string | null {
  const raw = readText('/etc/os-release')
  const match = raw?.match(/^PRETTY_NAME="([^"]+)"/m)
  return match?.[1] ?? null
}

export function detectUnrealRuntime(): HvsUnrealMachineTrace {
  const home = os.homedir()
  const searched = [
    '/opt/UnrealEngine',
    '/usr/local/UnrealEngine',
    path.join(home, 'UnrealEngine'),
    path.join(home, 'Unreal'),
    path.join(home, 'HVSRuntime'),
    path.join(home, 'Documents'),
    path.join(home, 'Unreal Projects'),
    'PATH',
  ]
  const editors: string[] = []
  for (const name of EDITOR_NAMES) {
    const found = which(name)
    if (found) editors.push(found)
  }
  const direct = [
    '/opt/UnrealEngine/Engine/Binaries/Linux/UnrealEditor',
    '/usr/local/UnrealEngine/Engine/Binaries/Linux/UnrealEditor',
    path.join(home, 'UnrealEngine/Engine/Binaries/Linux/UnrealEditor'),
    path.join(home, 'Unreal/Engine/Binaries/Linux/UnrealEditor'),
  ]
  for (const file of direct) if (existsSync(file)) editors.push(file)
  try {
    for (const name of readdirSync(home)) {
      if (!/^UnrealEngine/i.test(name)) continue
      const editor = path.join(home, name, 'Engine/Binaries/Linux/UnrealEditor')
      searched.push(path.join(home, name))
      if (existsSync(editor)) editors.push(editor)
    }
  } catch {
    /* home unreadable */
  }
  const projects: string[] = []
  listUprojects(path.join(home, 'Documents'), 2, projects)
  listUprojects(path.join(home, 'Unreal Projects'), 2, projects)
  listUprojects(home, 1, projects)
  const editorPath = editors[0] ?? null
  const installPath = editorPath ? path.resolve(editorPath, '..', '..', '..', '..') : null
  const version = editorPath ? versionNear(editorPath) : null
  const installed: HvsUnrealMachineTrace['installed'] = editorPath ? (version ? 'YES' : 'PARTIAL') : 'NO'
  const clang = which('clang')
  let clangVersion: string | null = null
  if (clang) {
    try {
      clangVersion = execFileSync(clang, ['--version'], { encoding: 'utf8', timeout: 2000 }).split('\n')[0] ?? null
    } catch {
      clangVersion = clang
    }
  }
  let glibc: string | null = null
  try {
    glibc = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8', timeout: 2000 }).trim()
  } catch {
    glibc = null
  }
  const card = gpu()
  return {
    installed,
    version,
    installPath,
    editorPath,
    projects,
    epicLauncher: 'NOT_FOUND',
    sourceTree: 'NOT_FOUND',
    metahumanAssets: existsSync(path.join(home, 'MetaHumans')) || existsSync('/opt/MetaHuman') ? 'FOUND' : 'NOT_FOUND',
    downloadedThisProcess: false,
    error: null,
    searched,
    gpu: card,
    os: {
      prettyName: prettyOs(),
      kernel: os.release(),
      glibc,
      clang: clangVersion,
      vulkanNvidiaIcd: existsSync('/usr/share/vulkan/icd.d/nvidia_icd.json'),
      vulkaninfo: Boolean(which('vulkaninfo')),
    },
    linux: {
      machineProven: [
        editorPath ? `UnrealEditor found at ${editorPath}.` : 'No UnrealEditor binary was found in the searched paths.',
        projects.length ? `${projects.length} .uproject file(s) found, including ${projects[0]}.` : 'No .uproject was found in the searched paths.',
        `OS ${prettyOs() ?? 'unknown'} kernel ${os.release()}.`,
        `GPU probe nvidia-smi ${card.nvidiaSmi}${card.name ? `: ${card.name} driver ${card.driver} ${card.memoryMiB} MiB` : ''}.`,
        `NVIDIA Vulkan ICD file ${existsSync('/usr/share/vulkan/icd.d/nvidia_icd.json') ? 'present' : 'absent'}. vulkaninfo ${which('vulkaninfo') ? 'present' : 'not installed'}.`,
        `Host clang ${clangVersion ?? 'not found'}.`,
        `MetaHuman assets ${existsSync(path.join(home, 'MetaHumans')) || existsSync('/opt/MetaHuman') ? 'FOUND' : 'NOT_FOUND'}.`,
      ],
      official: [
        'Recommended development OS on the UE 5.8 page is Ubuntu 22.04 and Rocky Linux 8. This machine is newer than that recommendation.',
        'Running the engine is documented for Rocky Linux 8 / Red Hat Linux 8 or newer, kernel 4.18 or newer, glibc 2.28 or newer.',
        'Native compiler documented for UE 5.7–5.8 is clang 20.1.8, supplied by Setup.sh. Host clang is not that pinned toolchain.',
        'Documented RHI is Vulkan, NVIDIA driver 570 or newer. Lumen/Nanite text lists NVIDIA RTX 2000-series or newer. This probe does not run those features.',
        'The Linux requirements page documents Setup.sh native toolchain and Windows cross-compile. It does not document an Epic Games Launcher install on Linux.',
      ],
      officialDoc: 'Epic Games — Linux Development Requirements for Unreal Engine (5.8 documentation)',
    },
  }
}

export function prepareUnrealCommand(trace: HvsUnrealMachineTrace, packagePath: string): {
  mode: 'FILE_PACKAGE'
  launch: false
  executable: string | null
  args: string[]
  runtime: 'NOT_INSTALLED' | 'PREPARED'
} {
  if (!trace.editorPath) {
    return { mode: 'FILE_PACKAGE', launch: false, executable: null, args: [], runtime: 'NOT_INSTALLED' }
  }
  return {
    mode: 'FILE_PACKAGE',
    launch: false,
    executable: trace.editorPath,
    args: [packagePath],
    runtime: 'PREPARED',
  }
}
