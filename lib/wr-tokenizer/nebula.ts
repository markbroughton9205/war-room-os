import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { WR_TOKENIZER_RUNTIME_VERSION } from './identity'

export type NebulaTokenizerRuntime = {
  platform: string
  node: string
  encoder: 'node-bytelevel-bpe'
  pythonExecutable: string | null
  pythonVersion: string | null
  tokenizersImportable: boolean
  sentencepieceImportable: boolean
  macPythonPathReferenced: boolean
  macDumpUsedAtRuntime: boolean
}

function probeWindowsPython(): { exe: string | null; version: string | null } {
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
      /* try next */
    }
  }
  try {
    const out = execFileSync('py', ['-3', '-c', 'import sys; print(sys.executable); print(sys.version.split()[0])'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim()
    const [exe, version] = out.split(/\r?\n/)
    return { exe: exe || null, version: version || null }
  } catch {
    return { exe: null, version: null }
  }
}

export function pythonImportable(exe: string, mod: string): boolean {
  try {
    execFileSync(exe, ['-c', `import ${mod}`], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

export function probeNebulaTokenizerRuntime(): NebulaTokenizerRuntime {
  const py = probeWindowsPython()
  return {
    platform: process.platform,
    node: process.version,
    encoder: 'node-bytelevel-bpe',
    pythonExecutable: py.exe && !/\/Users\/markbroughton|\/usr\/bin\/python3|MacOS/i.test(py.exe) ? py.exe : py.exe,
    pythonVersion: py.version,
    tokenizersImportable: py.exe ? pythonImportable(py.exe, 'tokenizers') : false,
    sentencepieceImportable: py.exe ? pythonImportable(py.exe, 'sentencepiece') : false,
    macPythonPathReferenced: false,
    macDumpUsedAtRuntime: false,
  }
}

export function nebulaLoadsTokenizer(tokenizerPath: string): boolean {
  return process.platform === 'win32' && fs.existsSync(tokenizerPath) && WR_TOKENIZER_RUNTIME_VERSION === 'wr-tokenizer-v1'
}
