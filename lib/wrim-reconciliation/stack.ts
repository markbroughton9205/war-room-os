import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pythonImportable } from '@/lib/wr-tokenizer/nebula'

export type NebulaMlStack = {
  pythonExecutable: string | null
  pythonVersion: string | null
  packages: Record<string, string>
  torchCuda: string | null
  llamaCpp: boolean
  ggufTools: boolean
  notes: string[]
}

function probePython(): { exe: string | null; version: string | null } {
  const candidates = [
    process.env.WAR_ROOM_PYTHON?.trim(),
    'C:\\Users\\markb\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
  ].filter((x): x is string => Boolean(x))
  for (const exe of candidates) {
    if (!fs.existsSync(exe)) continue
    try {
      const out = execFileSync(exe, ['-c', 'import sys; print(sys.version.split()[0])'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      }).trim()
      return { exe, version: out || null }
    } catch {
      /* next */
    }
  }
  return { exe: null, version: null }
}

function packageVersion(exe: string, mod: string): string {
  try {
    const out = execFileSync(exe, ['-c', `import ${mod},sys; print(getattr(${mod},'__version__','imported-no-version'))`], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || 'imported'
  } catch {
    return 'NOT_PRESENT'
  }
}

export function probeNebulaMlStack(): NebulaMlStack {
  const py = probePython()
  const mods = [
    'numpy',
    'torch',
    'mlx',
    'safetensors',
    'transformers',
    'tokenizers',
    'accelerate',
    'bitsandbytes',
    'deepspeed',
    'triton',
    'sentencepiece',
  ]
  const packages: Record<string, string> = {}
  if (py.exe) {
    for (const m of mods) packages[m] = packageVersion(py.exe, m)
  }
  let llamaCpp = false
  try {
    execFileSync('where.exe', ['llama-cli'], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    llamaCpp = true
  } catch {
    llamaCpp = false
  }
  return {
    pythonExecutable: py.exe,
    pythonVersion: py.version,
    packages,
    torchCuda: packages.torch && packages.torch !== 'NOT_PRESENT' ? 'see torch' : 'NOT_PRESENT',
    llamaCpp,
    ggufTools: llamaCpp,
    notes: [
      'No large ML packages were installed this pass.',
      'numpy is sufficient for header-safe + isolated CPU smoke if present.',
      'MLX is a Mac/Metal dependency and is not expected on Nebula Windows.',
      `tokenizers python importable=${py.exe ? pythonImportable(py.exe, 'tokenizers') : false}; Node BPE is canonical.`,
    ],
  }
}

export function pythonExecutable(): string | null {
  return probePython().exe
}
