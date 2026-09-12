import { PLANNED_STACK } from './pytorchPort'

export const SOFTWARE_INSTALL_PLAN = {
  executeNow: false,
  python: PLANNED_STACK.python,
  commandsPlanned: [
    'python -m venv "%LOCALAPPDATA%\\War Room OS\\venvs\\wrim-pytorch"',
    '"%LOCALAPPDATA%\\War Room OS\\venvs\\wrim-pytorch\\Scripts\\python.exe" -m pip install --upgrade pip',
    '"%LOCALAPPDATA%\\War Room OS\\venvs\\wrim-pytorch\\Scripts\\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cu130',
    '"%LOCALAPPDATA%\\War Room OS\\venvs\\wrim-pytorch\\Scripts\\python.exe" -m pip install safetensors tokenizers',
  ],
  fallbackIfCu130WheelMissing:
    'Retry the torch install from https://download.pytorch.org/whl/cu128. If no cp313 wheel exists, create a Python 3.12 venv instead of using 3.13.15. Do not source-build PyTorch in the first setup pass.',
  doNotInstall: [
    'NVIDIA CUDA Toolkit / nvcc (unless a later measured failure proves the wheel runtime is insufficient)',
    'torchvision',
    'torchaudio',
    'accelerate',
    'transformers',
    'bitsandbytes',
    'deepspeed',
    'mlx',
    'wandb / comet / mlflow',
  ],
  cudaToolkit: 'Avoid. PyTorch cu130/cu128 wheels bundle the CUDA runtime needed to talk to a 13.4 driver.',
}

export const BENCHMARK_PLAN = {
  executeNow: false,
  afterInstallMeasure: [
    'GPU detection: torch.cuda.is_available(), get_device_name, get_device_capability',
    'arch list includes sm_120 or equivalent Blackwell',
    'BF16: torch.cuda.is_bf16_supported() plus a 256x256 matmul',
    'FP16: tiny matmul without Inf',
    'VRAM allocation: empty_cache + max_memory_allocated after a 8x512 forward',
    'tokens/sec: 8x512 forward and 8x512 train step in FP32',
    'max stable micro-batch at seq=512 FP32 before OOM, leaving ≥2 GB free',
    'checkpoint save speed for 164 F32 tensors',
    'checkpoint load speed',
  ],
  doNotEstimateAsFacts: true,
}

export const INITIALIZATION = {
  parent: 'WRIM-0 checkpoint-final.safetensors model.* tensors only',
  collapsedWrim1: false,
  resumeMlxOptimizer: false,
  averageRejected: false,
  newOptimizer: true,
}
