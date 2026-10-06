/**
 * Slice 4 authorized local whisper.cpp + ggml-tiny.en.bin installer.
 * Does not download any other speech or generative-video model.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_SLICE4_ASR_TINY_EN_AUTHORIZED } from './policy'

export const WHISPER_CPP_GIT = 'https://github.com/ggml-org/whisper.cpp.git'
export const WHISPER_CPP_LICENSE = 'MIT'
export const TINY_EN_FILENAME = 'ggml-tiny.en.bin'
export const TINY_EN_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin'
export const TINY_EN_SHA256 = '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'
export const TINY_EN_BYTES = 77_704_715
export const TINY_EN_LICENSE = 'MIT (OpenAI Whisper weights via ggml conversion)'

export type WhisperInstallResult = {
  ok: boolean
  unauthorizedDownloads: number
  binaryPath: string | null
  modelPath: string | null
  modelBytes: number
  modelSha256: string | null
  source: string
  license: string
  error: string | null
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(bin: string, args: string[], cwd?: string, timeoutMs = 600_000) {
  return spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20_000_000 })
}

export function whisperPaths() {
  const dirs = mediaCommandDataHierarchy()
  return {
    src: path.join(dirs.tools, 'whisper.cpp-src'),
    binary: path.join(dirs.tools, 'whisper-cli'),
    modelDir: path.join(dirs.models, 'whisper'),
    model: path.join(dirs.models, 'whisper', TINY_EN_FILENAME),
    provenance: path.join(dirs.models, 'whisper', 'PROVENANCE.json'),
  }
}

export async function installAuthorizedTinyEn(): Promise<WhisperInstallResult> {
  if (!HVS_SLICE4_ASR_TINY_EN_AUTHORIZED) {
    return {
      ok: false,
      unauthorizedDownloads: 0,
      binaryPath: null,
      modelPath: null,
      modelBytes: 0,
      modelSha256: null,
      source: TINY_EN_URL,
      license: TINY_EN_LICENSE,
      error: 'HVS_SLICE4_ASR_TINY_EN_AUTHORIZED is false.',
    }
  }
  const paths = whisperPaths()
  mkdirSync(paths.modelDir, { recursive: true })
  mkdirSync(path.dirname(paths.binary), { recursive: true })

  if (!existsSync(path.join(paths.src, 'CMakeLists.txt'))) {
    const clone = run('git', ['clone', '--depth', '1', WHISPER_CPP_GIT, paths.src])
    if (clone.status !== 0) {
      return {
        ok: false,
        unauthorizedDownloads: 0,
        binaryPath: null,
        modelPath: null,
        modelBytes: 0,
        modelSha256: null,
        source: WHISPER_CPP_GIT,
        license: WHISPER_CPP_LICENSE,
        error: clone.stderr || 'git clone failed',
      }
    }
  }

  const built = path.join(paths.src, 'build', 'bin', 'whisper-cli')
  if (!existsSync(built) && !existsSync(paths.binary)) {
    const cmake = run('cmake', ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release'], paths.src)
    if (cmake.status !== 0) {
      return {
        ok: false,
        unauthorizedDownloads: 0,
        binaryPath: null,
        modelPath: null,
        modelBytes: 0,
        modelSha256: null,
        source: WHISPER_CPP_GIT,
        license: WHISPER_CPP_LICENSE,
        error: cmake.stderr || 'cmake configure failed',
      }
    }
    const build = run('cmake', ['--build', 'build', '--config', 'Release', '-j', String(4), '--target', 'whisper-cli'], paths.src, 900_000)
    if (build.status !== 0) {
      const fallback = run('cmake', ['--build', 'build', '--config', 'Release', '-j', '4'], paths.src, 900_000)
      if (fallback.status !== 0 && !existsSync(built)) {
        return {
          ok: false,
          unauthorizedDownloads: 0,
          binaryPath: null,
          modelPath: null,
          modelBytes: 0,
          modelSha256: null,
          source: WHISPER_CPP_GIT,
          license: WHISPER_CPP_LICENSE,
          error: (build.stderr || fallback.stderr || 'cmake build failed').slice(-800),
        }
      }
    }
  }

  const builtBin = existsSync(built)
    ? built
    : existsSync(path.join(paths.src, 'build', 'whisper-cli'))
      ? path.join(paths.src, 'build', 'whisper-cli')
      : null
  if (builtBin && !existsSync(paths.binary)) {
    copyFileSync(builtBin, paths.binary)
    chmodSync(paths.binary, 0o755)
  }

  if (!existsSync(paths.model) || sha256File(paths.model) !== TINY_EN_SHA256) {
    const dl = run('curl', ['-L', '--fail', '--retry', '3', '-o', paths.model, TINY_EN_URL], undefined, 180_000)
    if (dl.status !== 0) {
      return {
        ok: false,
        unauthorizedDownloads: 0,
        binaryPath: existsSync(paths.binary) ? paths.binary : null,
        modelPath: null,
        modelBytes: 0,
        modelSha256: null,
        source: TINY_EN_URL,
        license: TINY_EN_LICENSE,
        error: dl.stderr || 'model download failed',
      }
    }
  }

  const hash = existsSync(paths.model) ? sha256File(paths.model) : null
  const bytes = existsSync(paths.model) ? readFileSync(paths.model).length : 0
  if (hash !== TINY_EN_SHA256) {
    return {
      ok: false,
      unauthorizedDownloads: 0,
      binaryPath: existsSync(paths.binary) ? paths.binary : null,
      modelPath: paths.model,
      modelBytes: bytes,
      modelSha256: hash,
      source: TINY_EN_URL,
      license: TINY_EN_LICENSE,
      error: `SHA mismatch. expected ${TINY_EN_SHA256} got ${hash}`,
    }
  }

  writeFileSync(paths.provenance, `${JSON.stringify({
    model: TINY_EN_FILENAME,
    officialSource: TINY_EN_URL,
    repository: WHISPER_CPP_GIT,
    licenseRuntime: WHISPER_CPP_LICENSE,
    licenseModel: TINY_EN_LICENSE,
    sha256: hash,
    bytes,
    installedAt: new Date().toISOString(),
    authorizedBy: 'HVS_SLICE4_ASR_TINY_EN_AUTHORIZED',
    otherModelsDownloaded: [],
  }, null, 2)}\n`)

  return {
    ok: existsSync(paths.binary) && existsSync(paths.model),
    unauthorizedDownloads: 0,
    binaryPath: existsSync(paths.binary) ? paths.binary : null,
    modelPath: paths.model,
    modelBytes: bytes,
    modelSha256: hash,
    source: TINY_EN_URL,
    license: TINY_EN_LICENSE,
    error: existsSync(paths.binary) ? null : 'whisper-cli binary missing after build',
  }
}

if (process.argv[1]?.includes('whisper-install')) {
  const result = await installAuthorizedTinyEn()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}
