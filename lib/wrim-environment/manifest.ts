import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { decodeIds } from '@/lib/wr-tokenizer/encode'
import { dumpTokenizerPath } from '@/lib/wr-tokenizer/inspect'
import {
  CUDA_TOOLKIT_INSTALLED,
  PLANNED_INDEX,
  PLANNED_PYTHON,
  PLANNED_TORCH,
} from './identity'
import { ensureWrimEnvironmentDirs, resolveWrimEnvironmentPaths } from './paths'

function pipShow(venvPython: string, pkg: string): string | null {
  try {
    const out = execFileSync(venvPython, ['-m', 'pip', 'show', pkg], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    })
    const m = out.match(/^Version:\s*(.+)$/m)
    return m?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

export function writeEnvironmentManifest(opts?: { dataDirOverride?: string | null; dumpRoot?: string | null }) {
  const paths = resolveWrimEnvironmentPaths(opts?.dataDirOverride)
  ensureWrimEnvironmentDirs(paths)
  if (!fs.existsSync(paths.reportPath)) {
    throw new Error(`Stage 0 report missing at ${paths.reportPath}`)
  }
  const report = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8')) as {
    cpu?: { new_ids?: number[]; argmax_id?: number; entropy?: number; pass?: boolean }
    cuda_stage0?: { new_ids?: number[]; argmax_id?: number; entropy?: number; pass?: boolean }
    cuda?: { name?: string; capability?: number[]; available?: boolean }
    software?: { torch?: string; torch_cuda?: string; python?: string }
    WRIM_ENVIRONMENT?: string
    WRIM_PYTORCH_PORT?: string
    precision?: Record<string, string>
  }
  const tokPath = dumpTokenizerPath(opts?.dumpRoot)
  const cpuText = decodeIds(report.cpu?.new_ids ?? [], tokPath, true)
  const cudaText = decodeIds(report.cuda_stage0?.new_ids ?? [], tokPath, true)
  const manifest = {
    timestamp: new Date().toISOString(),
    python_version: report.software?.python ?? PLANNED_PYTHON,
    python_executable: paths.venvPython,
    venv_path: paths.venvRoot,
    torch_version: pipShow(paths.venvPython, 'torch') ?? report.software?.torch ?? PLANNED_TORCH,
    torch_cuda_version: report.software?.torch_cuda ?? '13.0',
    nvidia_driver: '32.0.16.1664 / NVIDIA-SMI 616.64 / CUDA UMD 13.4',
    gpu: report.cuda?.name ?? null,
    compute_capability: report.cuda?.capability ?? null,
    safetensors_version: pipShow(paths.venvPython, 'safetensors'),
    tokenizers_version: pipShow(paths.venvPython, 'tokenizers'),
    numpy_version: pipShow(paths.venvPython, 'numpy'),
    install_source: PLANNED_INDEX,
    install_reason:
      'Official stable torch-2.13.0+cu130-cp313-cp313-win_amd64.whl exists. Driver CUDA UMD 13.4 can load CUDA 13.0 runtime. RTX 5060 Ti is Blackwell sm_120; torch 2.13 cu130 arch list includes sm_120. Python 3.13.15 is supported by that wheel. Bundled CUDA runtime — no toolkit. Not nightly.',
    cuda_toolkit_installed: CUDA_TOOLKIT_INSTALLED,
    WRIM_ENVIRONMENT: report.WRIM_ENVIRONMENT,
    WRIM_PYTORCH_PORT: report.WRIM_PYTORCH_PORT,
    precision: report.precision,
    cpu_continuation_decoded: cpuText,
    cuda_continuation_decoded: cudaText,
    historical_continuation: ' a\n}_tokenizer_tokenizer_',
    continuation_match:
      cpuText === ' a\n}_tokenizer_tokenizer_' && cudaText === ' a\n}_tokenizer_tokenizer_',
    telemetry: 'OFF',
    network: 'install-only official indexes; inference local',
    secrets: false,
  }
  fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return { paths, manifest, report }
}
